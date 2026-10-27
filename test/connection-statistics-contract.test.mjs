import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionEventSchema, connectionReceiptSchema, connectionAggregateSchema, validateConnectionEvent } from '../lib/connection-statistics-contract.js';
const event = {schemaVersion:1,eventId:'e51e632e-3435-4d85-a2df-bf144a8ec7c2',instanceId:'7dff50f3-1225-4c27-b44b-ce97844cdb52',connectorId:'public',eventType:'first_success',occurredAt:'2026-10-27T03:00:00.000Z',pluginVersion:'0.2.83'};
const policy={publicIds:new Set(['public']),now:Date.parse(event.occurredAt),maxAgeMs:7*86400000,futureSkewMs:300000};
const validate=x=>validateConnectionEvent(JSON.stringify(x),policy);
test('strict events accept only explicit successful states and public cards',()=>{
 assert.equal(validate(event).ok,true);
 assert.equal(validate({...event,eventType:'baseline_success'}).ok,true);
 for(const eventType of ['click','baseline','failed']) assert.equal(validate({...event,eventType}).ok,false);
 assert.equal(validate({...event,connectorId:'private-url'}).code,'unknown_connector');
 assert.equal(connectionEventSchema.safeParse({...event,instanceId:'user@example.com'}).success,false);
});
test('credentials and malformed/oversized bodies are rejected without echoing data',()=>{
 const r=validate({...event,token:'SECRET'});assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/SECRET/);
 assert.equal(validateConnectionEvent('{',policy).ok,false);
 assert.equal(validateConnectionEvent('界'.repeat(1400),policy).code,'invalid_body');
});
test('time policy is explicit and rejects stale or future events',()=>{
 for(const offset of [-8*86400000,300001]) assert.equal(validate({...event,occurredAt:new Date(policy.now+offset).toISOString()}).code,'invalid_time');
 assert.throws(()=>validateConnectionEvent(JSON.stringify(event),{}));
});
test('only confirmed receipts can acknowledge queue delivery',()=>{
 for(const status of ['accepted','duplicate']) assert.equal(connectionReceiptSchema.safeParse({ok:true,status}).success,true);
 for(const r of [{ok:true},{ok:false,status:'accepted'},{ok:true,status:'queued'},{ok:true,status:'accepted',token:'x'}]) assert.equal(connectionReceiptSchema.safeParse(r).success,false);
});
test('aggregates preserve unknowns and reject contradictory counts and duplicated cards',()=>{
 const row={connectorId:'public',cumulativeSuccessfulConnections:2,newSuccessfulConnections30d:1};
 const a={schemaVersion:1,scope:'participating-instances',startedAt:event.occurredAt,updatedAt:event.occurredAt,items:[row]};
 assert.equal(connectionAggregateSchema.safeParse(a).success,true);
 assert.equal(connectionAggregateSchema.parse({...a,items:[{...row,cumulativeSuccessfulConnections:null,newSuccessfulConnections30d:null}]}).items[0].cumulativeSuccessfulConnections,null);
 for(const items of [[row,row],[{...row,newSuccessfulConnections30d:3}],[{...row,cumulativeSuccessfulConnections:-1}],[{...row,instanceId:event.instanceId}]]) assert.equal(connectionAggregateSchema.safeParse({...a,items}).success,false);
 assert.equal(connectionAggregateSchema.safeParse({...a,updatedAt:'2026-10-26T00:00:00Z'}).success,false);
});
