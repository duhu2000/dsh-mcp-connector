/** Offline-ready outbox. Not wired to Host until backend/privacy policy is approved. */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { connectionEventSchema, connectionReceiptSchema } from './connection-statistics-contract.js';
const DAY = 86400000;
const stateSchema = z.object({
  version:z.literal(1), enabled:z.boolean(), revision:z.number().int().nonnegative(),
  instanceId:z.string().uuid().nullable(), baseline:z.array(z.string()), seen:z.array(z.string()),
  pending:z.array(z.object({event:connectionEventSchema,attempts:z.number().int().nonnegative(),nextAt:z.number(),leaseUntil:z.number()}).strict()).max(500),
}).strict();
const empty=()=>({version:1,enabled:false,revision:0,instanceId:null,baseline:[],seen:[],pending:[]});

/** Exclusive directory lock; never steals an expired lock from a possibly live Host.
 * A crash may leave a lock requiring operator cleanup while ALL Hosts are stopped.
 */
export class StatisticsFileStore {
  constructor(directory) { this.directory=directory; }
  async transaction(action) {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const lock=join(this.directory,'transaction.lock');
    const deadline=Date.now()+2000;
    for (;;) {
      try { await mkdir(lock,{mode:0o700}); break; }
      catch(e) { if(e.code!=='EEXIST') throw e; if(Date.now()>=deadline) throw Error('Statistics storage busy'); await new Promise(r=>setTimeout(r,20)); }
    }
    const file=join(this.directory,'outbox.json');
    const temp=join(this.directory,`.outbox-${randomUUID()}.tmp`);
    try {
      let state;
      try { state=stateSchema.parse(JSON.parse(await readFile(file,'utf8'))); }
      catch(e) { if(e.code!=='ENOENT') throw Error('Statistics storage invalid'); state=empty(); }
      const result=await action(state);
      const handle=await open(temp,'wx',0o600);
      try { await handle.writeFile(JSON.stringify(stateSchema.parse(state))); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temp,file);
      // Persist the rename before a send can be acknowledged locally.
      const directory=await open(this.directory,'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return result;
    } finally { await rm(temp,{force:true}); await rm(lock,{recursive:true,force:true}); }
  }
}

export class ConnectionStatisticsOutbox {
  constructor(store,{publicIds,pluginVersion,now=Date.now,capacity=500}={}) {
    if(!(publicIds instanceof Set)||!Number.isInteger(capacity)||capacity<1||capacity>500) throw Error('Invalid outbox configuration');
    this.store=store;this.publicIds=publicIds;this.pluginVersion=pluginVersion;this.now=now;this.capacity=capacity;
  }
  async status() {
    return this.store.transaction(s=>({enabled:s.enabled,revision:s.revision,pending:s.pending.length}));
  }
  async setParticipation(enabled,{baselineIds=[]}={}) {
    if(typeof enabled!=='boolean') throw Error('Explicit boolean participation required');
    return this.store.transaction(s=>{
      if(s.enabled!==enabled) {
        s.enabled=enabled;s.revision++;s.pending=[];
        if(enabled) {
          s.instanceId??=randomUUID();
          s.baseline=[...new Set([...s.baseline,...baselineIds.filter(id=>this.publicIds.has(id))])];
        }
      }
      return {enabled:s.enabled,revision:s.revision};
    });
  }
  /** revision is captured before the connection starts; old callbacks cannot enroll retroactively. */
  async recordSuccess(connectorId,revision) {
    return this.store.transaction(s=>{
      if(!s.enabled||s.revision!==revision||!this.publicIds.has(connectorId)||s.seen.includes(connectorId)) return false;
      const time=this.now();
      s.pending=s.pending.filter(p=>time-Date.parse(p.event.occurredAt)<=7*DAY);
      // Mark observed even when full: a later reconnect must not masquerade as today's first success.
      s.seen.push(connectorId);
      if(s.pending.length>=this.capacity) return false;
      const event=connectionEventSchema.parse({schemaVersion:1,eventId:randomUUID(),instanceId:s.instanceId,connectorId,
        eventType:s.baseline.includes(connectorId)?'baseline_success':'first_success',occurredAt:new Date(time).toISOString(),pluginVersion:this.pluginVersion});
      s.pending.push({event,attempts:0,nextAt:time,leaseUntil:0});return true;
    });
  }
  /** transport is injected only by an approved integration. No URL/default network client here.
   * transport(event, signal) returns {status, body, retryAfterMs?}. One bounded send per call.
   */
  async flushOne(transport) {
    if(typeof transport!=='function') return {sent:false};
    const claim=await this.store.transaction(s=>{
      if(!s.enabled) return null;
      const time=this.now();
      s.pending=s.pending.filter(p=>time-Date.parse(p.event.occurredAt)<=7*DAY&&p.attempts<10);
      const p=s.pending.find(p=>p.nextAt<=time&&p.leaseUntil<=time);
      if(!p) return null;
      p.leaseUntil=time+30000;p.attempts++;
      return {event:structuredClone(p.event),revision:s.revision};
    });
    if(!claim) return {sent:false};
    // Recheck consent after acquiring the claim. Revocation cannot retract an already sent request.
    const consent=await this.status();
    if(!consent.enabled||consent.revision!==claim.revision) return {sent:false};
    const controller=new AbortController();let timer,response;
    try {
      response=await Promise.race([Promise.resolve().then(()=>transport(claim.event,controller.signal)),new Promise((_,reject)=>{
        timer=setTimeout(()=>{controller.abort();reject(Error('Statistics send timeout'));},5000);
      })]);
    } catch { response=null; } finally {clearTimeout(timer);}
    const receipt=connectionReceiptSchema.safeParse(response?.body);
    const accepted=[200,201].includes(response?.status)&&receipt.success;
    const terminal=[400,403,409,422].includes(response?.status);
    await this.store.transaction(s=>{
      if(!s.enabled||s.revision!==claim.revision) return;
      const index=s.pending.findIndex(p=>p.event.eventId===claim.event.eventId);if(index<0)return;
      const p=s.pending[index];
      if(accepted||terminal||p.attempts>=10) {s.pending.splice(index,1);return;}
      const delay=Number.isFinite(response?.retryAfterMs)?Math.max(1000,Math.min(DAY,response.retryAfterMs)):Math.min(3600000,1000*2**p.attempts);
      p.nextAt=this.now()+delay;p.leaseUntil=0;
    });
    return {sent:true,acknowledged:accepted};
  }
}
