import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CommunityStatisticsService,observeCommunitySuccess} from '../lib/connection-statistics-service.js';
const deployment={baseUrl:'https://stats.example.invalid/connector/',policyText:'Test retention and deletion policy',policyVersion:'test-1'};
async function setup(t,fetchImpl){const directory=await mkdtemp(join(tmpdir(),'stats-service-'));t.after(()=>rm(directory,{recursive:true,force:true}));const service=new CommunityStatisticsService({directory,deployment,publicIds:new Set(['a']),pluginVersion:'0.2.83',fetchImpl});t.after(()=>service.dispose());return service;}
test('unconfigured production cannot opt in, create identity, upload or fetch metrics',async()=>{
 let calls=0;const s=new CommunityStatisticsService({fetchImpl:()=>calls++});
 assert.equal((await s.status()).configured,false);assert.equal((await s.participation(true,'x',[])).ok,false);
 await s.tick();assert.equal((await s.aggregate()).available,false);assert.equal(calls,0);
});
test('Host success respects participation and ships strict event through bounded transport',async t=>{
 let calls=0;
 const s=await setup(t,async(url,opts)=>{calls++;assert.equal(String(url),'https://stats.example.invalid/connector/v1/connection-events');assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');const e=JSON.parse(opts.body);assert.equal(e.connectorId,'a');assert.equal(e.eventType,'first_success');return new Response(JSON.stringify({ok:true,status:'accepted'}),{status:201});});
 assert.equal((await s.participation(true,'old',[])).ok,false);
 await s.participation(true,'test-1',[]);const state=await s.status();await s.record('a',state.revision);await s.tick();
 assert.equal(calls,1);assert.equal((await s.status()).pending,0);
});
test('policy change suspends existing consent until expressly accepted again',async t=>{
 const s=await setup(t,()=>{throw Error('must not send')});await s.participation(true,'test-1',[]);
 s.deployment={...deployment,policyVersion:'test-2'};assert.equal((await s.status()).enabled,false);await s.tick();
 assert.equal((await s.participation(true,'test-1',[])).ok,false);
 assert.equal((await s.participation(true,'test-2',[])).ok,true);
});
test('aggregate cache rejects stale, private and contradictory metrics',async t=>{
 let calls=0;let body={schemaVersion:1,scope:'participating-instances',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),items:[{connectorId:'a',cumulativeSuccessfulConnections:2,newSuccessfulConnections30d:1},{connectorId:'private',cumulativeSuccessfulConnections:99,newSuccessfulConnections30d:1}]};
 const s=await setup(t,async()=>{calls++;return new Response(JSON.stringify(body));});
 const result=await s.aggregate();assert.equal(result.available,true);assert.equal(result.items.length,1);await s.aggregate();assert.equal(calls,1);
 s.cache=null;body.updatedAt='2020-01-01T00:00:00Z';assert.equal((await s.aggregate()).available,false);
});
test('redirects and failures do not erase queued event; retries keep business separate',async t=>{
 const s=await setup(t,async()=>new Response('',{status:302}));await s.participation(true,'test-1',[]);await s.record('a',(await s.status()).revision);await s.tick();assert.equal((await s.status()).pending,1);
 await s.participation(false,'test-1',[]);assert.equal((await s.status()).pending,0);
});
test('slow statistics storage cannot block a business connect indefinitely',async()=>{
 const api={connect:async()=>({ok:true}),configure:async()=>({ok:false})};
 observeCommunitySuccess(api,{status:()=>new Promise(()=>{}),record:()=>{throw Error('not enrolled')}});
 assert.equal((await api.connect('a')).ok,true);
});
