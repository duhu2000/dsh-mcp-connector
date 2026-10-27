/** Host integration boundary. Production deployment is deliberately unset pending backend acceptance. */
import { ConnectionStatisticsOutbox, StatisticsFileStore } from './connection-statistics-outbox.js';
import { connectionAggregateSchema } from './connection-statistics-contract.js';
export const COMMUNITY_STATISTICS_DEPLOYMENT = null;
export class CommunityStatisticsService {
  constructor({deployment=COMMUNITY_STATISTICS_DEPLOYMENT,directory,publicIds,pluginVersion,fetchImpl=globalThis.fetch,now=Date.now}={}) {
    this.deployment=deployment;this.now=now;this.fetchImpl=fetchImpl;this.publicIds=publicIds;
    this.cache=null;this.controllers=new Set();this.disposed=false;this.busy=false;this.lastError=null;
    if(deployment) {
      const base=new URL(deployment.baseUrl);
      if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!deployment.policyText||!deployment.policyVersion||!directory) throw Error('Statistics deployment incomplete');
      if(!base.pathname.endsWith('/'))base.pathname+='/';
      this.base=base;
      this.box=new ConnectionStatisticsOutbox(new StatisticsFileStore(directory),{publicIds,pluginVersion,now});
    }
  }
  async status(){
    if(!this.box) return {configured:false,enabled:false,reason:'社区统计服务尚未部署，当前仅提供本机统计。'};
    try{const s=await this.box.status();return {configured:true,...s,enabled:s.enabled&&s.consentPolicy===this.deployment.policyVersion,policyText:this.deployment.policyText,policyVersion:this.deployment.policyVersion,lastError:this.lastError};}
    catch{return {configured:true,enabled:false,available:false,reason:'统计存储不可用，不影响业务连接。'};}
  }
  async participation(enabled,policyVersion,baselineIds){
    if(!this.box) return {ok:false,message:'社区统计服务尚未部署，无法开启。'};
    if(enabled && policyVersion!==this.deployment.policyVersion) return {ok:false,message:'统计说明已变更，请重新查看后开启。'};
    if(!enabled) for(const c of this.controllers)c.abort();
    try {await this.box.setParticipation(enabled,{baselineIds,policyVersion:this.deployment.policyVersion});return {ok:true,message:enabled?'已开启社区统计':'已关闭并清空未发送队列'};}
    catch{return {ok:false,message:'统计设置保存失败，请检查 Host 日志；业务连接不受影响。'};}
  }
  async request(path,options={}){
    if(this.disposed)throw Error('Statistics disposed');
    const controller=new AbortController();this.controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),5000);
    try {
      const response=await this.fetchImpl(new URL(path,this.base),{...options,signal:controller.signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
      if(response.status>=300&&response.status<400)throw Error('Redirect forbidden');
      const reader=response.body?.getReader();if(!reader)throw Error('Missing body');
      let size=0;const chunks=[];
      try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024)throw Error('Response too large');chunks.push(Buffer.from(value));}}
      finally {await reader.cancel().catch(()=>{});}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{body=null;}
      const retry=response.headers.get('retry-after');
      const retryAfterMs=retry?(/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-this.now()):undefined;
      return {status:response.status,body,retryAfterMs};
    }finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  async record(id,revision,startedAt){if(this.box&&!this.disposed)try{await this.box.recordSuccess(id,revision,startedAt);}catch{this.lastError='统计入队失败';}}
  async tick(){
    if(!this.box||this.disposed||this.busy)return;this.busy=true;
    try {if(!(await this.status()).enabled)return;await this.box.flushOne(event=>this.request('v1/connection-events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event)}));}
    catch{this.lastError='统计发送或存储不可用';}finally{this.busy=false;}
  }
  async aggregate(){
    if(!this.box)return {available:false,items:[]};
    if(this.cache&&this.now()-this.cache.fetchedAt<300000)return this.cache.data;
    try{
      const r=await this.request('v1/connector-statistics');
      if(r.status!==200)throw Error('Aggregate unavailable');
      const d=connectionAggregateSchema.parse(r.body);
      if(Date.parse(d.updatedAt)>this.now()+300000||this.now()-Date.parse(d.updatedAt)>86400000)throw Error('Aggregate stale');
      const data={available:true,...d,items:d.items.filter(x=>this.publicIds.has(x.connectorId))};
      this.cache={fetchedAt:this.now(),data};return data;
    }catch{return {available:false,items:[]};}
  }
  dispose(){this.disposed=true;for(const c of this.controllers)c.abort();}
}
/** Consent is sampled before action. Statistics failures never change the business result. */
export function observeCommunitySuccess(api,service){
 if(service instanceof CommunityStatisticsService && !service.box)return;
 for(const method of ['connect','configure']){
  const original=api[method];api[method]=async function(...args){
   const startedAt=service.now?.() ?? Date.now();
   let timer;
   const consentPromise=Promise.race([service.status().catch(()=>({enabled:false})),new Promise(resolve=>{timer=setTimeout(()=>resolve({enabled:false}),100);})]).finally(()=>clearTimeout(timer));
   const result=await original.apply(this,args);
   const consent=await consentPromise;
   const id=method==='connect'?args[0]:args[0]?.connectorId;
   if(result?.ok&&consent.enabled&&typeof id==='string')void service.record(id,consent.revision,startedAt).catch(()=>{});
   return result;
  };
 }
}
