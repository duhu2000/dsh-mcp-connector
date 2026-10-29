import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionStatistics, observeConnectionSuccess } from '../lib/connection-statistics.js';
const DAY = 86400000;
function fixture() {
  const rows = new Map();
  const table = { entries: () => rows.entries(), put: async (k,v) => rows.set(k, structuredClone(v)) };
  let now = 100 * DAY;
  const stats = new ConnectionStatistics(table, { now: () => now });
  return { rows, table, stats, advance: n => now += n * DAY };
}
test('concurrent multi-server/reconnect attempts count one card, durable across restart', async () => {
  const {stats,table} = fixture();
  await Promise.all(Array.from({length:20}, () => stats.success('public-card')));
  assert.equal(stats.snapshot().cumulativeSuccessfulConnections,1);
  const restarted = new ConnectionStatistics(table);
  await restarted.load(); await restarted.success('public-card');
  assert.equal(restarted.snapshot().cumulativeSuccessfulConnections,1);
});
test('30-day window ages out without reducing cumulative total', async () => {
  const {stats,advance}=fixture(); await stats.success('a'); advance(31);
  assert.equal(stats.snapshot().newSuccessfulConnections30d,0);
  assert.equal(stats.snapshot().cumulativeSuccessfulConnections,1);
});
test('historical baseline is never invented as a successful install or new connection', async () => {
  const {stats}=fixture(); await stats.baseline(['a','a']);
  assert.equal(stats.snapshot().cumulativeSuccessfulConnections,0);
  await stats.success('a'); await stats.baseline(['a']);
  assert.equal(stats.snapshot().cumulativeSuccessfulConnections,1);
  assert.equal(stats.snapshot().newSuccessfulConnections30d,0);
});
test('only successful requested catalog cards count; failed OAuth, custom/JSON and extra grant resources do not', async () => {
  const {stats}=fixture();
  const api={connect: async id => ({ok:id!=='failed',detail:{keys:['extra-resource']}}),configure:async()=>({ok:true})};
  observeConnectionSuccess(api,stats,{known: id=>['a','b','failed'].includes(id)});
  await api.connect('failed'); await api.connect('private'); await api.configure({url:'https://private.invalid',token:'secret'});
  assert.equal(stats.snapshot().cumulativeSuccessfulConnections,0);
  await api.connect('a'); await api.configure({connectorId:'b',credential:'secret'});
  await stats.queue;
  assert.equal(stats.snapshot().cumulativeSuccessfulConnections,2);
  assert.doesNotMatch(JSON.stringify(stats.snapshot()),/secret|private|extra-resource/);
});
test('storage failure cannot turn a working connection into failure or publish an unpersisted counter', async () => {
  const {stats,table}=fixture(); table.put=async()=>{throw Error('disk failure')};
  const api={connect:async()=>({ok:true}),configure:async()=>({ok:true})};
  let warnings=0;observeConnectionSuccess(api,stats,{known:()=>true,onError:()=>warnings++});
  assert.equal((await api.connect('a')).ok,true);
  await stats.queue.catch(() => {});
  assert.equal(stats.snapshot().cumulativeSuccessfulConnections,0);
  assert.equal(stats.snapshot().available,false);assert.equal(warnings,1);
});
test('thrown or rolled back final operations are never recorded', async () => {
  const {stats}=fixture();const api={connect:async()=>{throw Error('rollback')},configure:async()=>({ok:false})};
  observeConnectionSuccess(api,stats,{known:()=>true});
  await assert.rejects(api.connect('a'));await api.configure({connectorId:'b'});
  assert.equal(stats.snapshot().cumulativeSuccessfulConnections,0);
});

test('hung statistics storage is bounded and does not block later connections', async () => {
  const {stats,table}=fixture(); table.put=()=>new Promise(()=>{});
  stats.timeoutMs = 100;
  const api={connect:async()=>({ok:true}),configure:async()=>({ok:true})};
  observeConnectionSuccess(api,stats,{known:()=>true});
  const result=await api.connect('a');
  assert.equal(result.ok,true);
  assert.equal(stats.available,true, 'connection returned before the storage deadline');
  await stats.queue.catch(() => {});
  assert.equal(stats.available,false);
  assert.equal((await api.connect('b')).ok,true);
  assert.equal(stats.snapshot().cumulativeSuccessfulConnections,0);
});

test('pending storage does not delay responses; late completion cannot revive timed-out statistics', async () => {
  const {stats,table}=fixture();
  let finish;
  table.put=()=>new Promise(resolve=>{finish=resolve;});
  stats.timeoutMs=20;
  const api={connect:async()=>({ok:true}),configure:async()=>({ok:true})};
  observeConnectionSuccess(api,stats,{known:()=>true,onError:()=>{throw Error('logger failed');}});
  assert.equal((await api.connect('a')).ok,true);
  await stats.queue.catch(()=>{});
  finish();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stats.snapshot().cumulativeSuccessfulConnections,0);
  assert.equal(stats.available,false);
});

test('queue has a fixed bound and skips pending writes after overload', async () => {
  const {stats,table}=fixture(); stats.maxPending=2;
  let writes=0;table.put=async()=>{writes++;};
  const first=stats.success('a'),second=stats.success('b');
  await assert.rejects(stats.success('c'),/queue full/);
  await Promise.all([first,second]);
  assert.equal(writes,0);
  assert.equal(stats.pending,0);
  assert.equal(stats.available,false);
});

test('baseline writes time out and disposal prevents queued writes', async () => {
  const {stats,table}=fixture();stats.timeoutMs=10;
  table.put=()=>new Promise(()=>{});
  await assert.rejects(stats.baseline(['old']),/timeout/);
  assert.equal(stats.available,false);
  const fresh=fixture();const pending=fresh.stats.success('a');fresh.stats.dispose();
  await pending;
  assert.equal(fresh.rows.size,0);
});
