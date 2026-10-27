import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StatisticsFileStore,ConnectionStatisticsOutbox} from '../lib/connection-statistics-outbox.js';
async function fixture(t,capacity=500){
 const dir=await mkdtemp(join(tmpdir(),'connector-outbox-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let now=Date.parse('2026-10-27T00:00:00Z');
 const create=()=>new ConnectionStatisticsOutbox(new StatisticsFileStore(dir),{publicIds:new Set(['a','b','c']),pluginVersion:'0.2.83',now:()=>now,capacity});
 return {box:create(),create,dir,advance:ms=>now+=ms};
}
test('default off, explicit participation, no old callback or private-card enrollment',async t=>{
 const {box}=await fixture(t);assert.equal(await box.recordSuccess('a',0),false);
 const {revision}=await box.setParticipation(true);
 assert.equal(await box.recordSuccess('a',0),false);assert.equal(await box.recordSuccess('private',revision),false);
 assert.equal(await box.recordSuccess('a',revision),true);
 await box.setParticipation(false);assert.equal((await box.status()).pending,0);
 let calls=0;await box.flushOne(()=>calls++);assert.equal(calls,0);
});
test('two store instances serialize durable dedup; restart preserves queued event ID',async t=>{
 const {box,create}=await fixture(t);const {revision}=await box.setParticipation(true);
 const other=create();await Promise.all([box.recordSuccess('a',revision),other.recordSuccess('a',revision)]);
 assert.equal((await create().status()).pending,1);
 let id;await create().flushOne(async event=>{id=event.eventId;return {status:201,body:{ok:true,status:'accepted'}}});
 assert.ok(id);assert.equal((await box.status()).pending,0);assert.equal(await other.recordSuccess('a',revision),false);
});
test('retry uses same event and respects backoff; unconfirmed 200 does not delete',async t=>{
 const {box,advance}=await fixture(t);const {revision}=await box.setParticipation(true);await box.recordSuccess('a',revision);
 const ids=[];const transport=async e=>{ids.push(e.eventId);return {status:200,body:{ok:true}}};
 await box.flushOne(transport);await box.flushOne(transport);assert.equal(ids.length,1);assert.equal((await box.status()).pending,1);
 advance(5000);await box.flushOne(async e=>{ids.push(e.eventId);return {status:200,body:{ok:true,status:'duplicate'}}});
 assert.equal(ids[0],ids[1]);assert.equal((await box.status()).pending,0);
});
test('baseline successful event, queue bound and seven-day expiry never invent recent success',async t=>{
 const {box,advance}=await fixture(t,1);const {revision}=await box.setParticipation(true,{baselineIds:['a']});
 await box.recordSuccess('a',revision);assert.equal(await box.recordSuccess('b',revision),false);
 await box.flushOne(async e=>{assert.equal(e.eventType,'baseline_success');return {status:201,body:{ok:true,status:'accepted'}}});
 assert.equal(await box.recordSuccess('b',revision),false);
 await box.recordSuccess('c',revision);advance(8*86400000);let sent=0;await box.flushOne(()=>sent++);assert.equal(sent,0);
});
test('disable during send clears queue; old response cannot resurrect it after reenable',async t=>{
 const {box}=await fixture(t);const {revision}=await box.setParticipation(true);await box.recordSuccess('a',revision);
 await box.flushOne(async()=>{await box.setParticipation(false);await box.setParticipation(true);return {status:201,body:{ok:true,status:'accepted'}}});
 assert.equal((await box.status()).pending,0);
});
test('durable file stores only event fields and consent state',async t=>{
 const {box,dir}=await fixture(t);await box.setParticipation(true);const state=JSON.parse(await readFile(join(dir,'outbox.json'),'utf8'));
 assert.equal(state.enabled,true);assert.equal(state.pending.length,0);assert.equal(typeof state.instanceId,'string');
});
test('separate processes cannot lose distinct queued events',async t=>{
 const {box,dir}=await fixture(t);const {revision}=await box.setParticipation(true);
 const {spawn}=await import('node:child_process');
 const moduleUrl=new URL('../lib/connection-statistics-outbox.js',import.meta.url).href;
 const run=id=>new Promise((resolve,reject)=>{
   const script=`import {StatisticsFileStore,ConnectionStatisticsOutbox} from ${JSON.stringify(moduleUrl)};const box=new ConnectionStatisticsOutbox(new StatisticsFileStore(process.argv[1]),{publicIds:new Set(['a','b']),pluginVersion:'0.2.83'});await box.recordSuccess(process.argv[2],Number(process.argv[3]));`;
   const p=spawn(process.execPath,['--input-type=module','-e',script,dir,id,String(revision)],{stdio:'pipe'});
   let error='';p.stderr.on('data',x=>error+=x);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(error)));
 });
 await Promise.all([run('a'),run('b')]);assert.equal((await box.status()).pending,2);
});
test('corrupt state fails closed without replacing history',async t=>{
 const {box,dir}=await fixture(t);const {writeFile}=await import('node:fs/promises');
 await writeFile(join(dir,'outbox.json'),'{broken');
 await assert.rejects(box.setParticipation(true),/storage invalid/);
 assert.equal(await readFile(join(dir,'outbox.json'),'utf8'),'{broken');
});
