import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceGenerated, syncProductDocs} from '../scripts/sync-product-docs.mjs';
import {freshnessErrors} from '../scripts/check-media-freshness.mjs';

test('only marked current version changes; historical and minimum versions survive', () => {
  const s='minimum 0.2.59+; history 0.2.46; <!-- generated:version -->0.2.81<!-- /generated:version -->';
  assert.equal(replaceGenerated(s,'version','0.2.82'),s.replace('0.2.81','0.2.82'));
  assert.throws(()=>replaceGenerated(s+'<!-- generated:version -->','version','x'),/duplicate/);
  assert.throws(()=>replaceGenerated('no marker','version','x'),/Missing/);
});

test('current product documentation matches its single source', async () => {
  assert.deepEqual(await syncProductDocs({check:true}),[]);
});

test('freshness distinguishes stale source/version/date, including one stale image or GIF', () => {
  const item={sourceVersion:'0.2.82',capturedOn:'2026-10-26'};
  const m={capture:{...item,sourceFingerprint:'hash'},screenshots:[{...item}],demo:{...item}};
  assert.deepEqual(freshnessErrors(m,'0.2.82','hash',new Date('2026-10-26T00:00Z')),[]);
  assert.match(freshnessErrors(m,'0.2.83','hash',new Date('2026-10-26T00:00Z')).join(),/version/);
  assert.match(freshnessErrors(m,'0.2.82','changed',new Date('2026-10-26T00:00Z')).join(),/source/);
  assert.match(freshnessErrors(m,'0.2.82','hash',new Date('2026-11-20T00:00Z')).join(),/14 days/);
  m.demo.sourceVersion='0.2.46';
  assert.match(freshnessErrors(m,'0.2.82','hash',new Date('2026-10-26T00:00Z')).join(),/version/);
});
