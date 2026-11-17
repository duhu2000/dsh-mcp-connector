import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { resolveSmartProductionScope } from '../lib/smart-mode-production.js';
import { loadSmartModeHost } from '../lib/smart-mode-host.js';
import { enterpriseFixture } from '../scripts/fixtures/smart-mode-enterprise.mjs';
import { temporaryProfile } from '../scripts/fixtures/smart-mode-profile.mjs';

function fixture() {
  const data = enterpriseFixture(), records = data.records.slice(0, 6).map((record) => ({ ...record,
    url: `https://agent.qcc.com/mcp/${record.serverKey}/stream`, transport: 'streamable-http' }));
  const descriptors = [{ id: 'qcc-company', auth: { issuer: 'https://agent.qcc.com' }, servers: records.map((record) => ({
    serverName: record.serverName, serverKey: record.serverKey, url: record.url, transport: record.transport,
  })) }];
  const grants = new Map([[data.scope.accountRef, { grant: { account: 'default', issuer: 'https://agent.qcc.com' } }]]);
  return { account: 'default', records, descriptors, grants };
}
test('production scope automatically binds exactly six enterprise servers in the selected account/grant', () => {
  const f = fixture();
  f.grants.set('other', { grant: { account: 'other-account', issuer: 'https://agent.qcc.com' } });
  assert.equal(resolveSmartProductionScope(f).connections.length, 6);
  assert.equal(resolveSmartProductionScope(f).accountRef, 'synthetic-grant-a');
  assert.equal(resolveSmartProductionScope(f).groupId, 'qcc-enterprise-six-v1');
});
for (const kind of ['missing', 'account', 'issuer', 'endpoint', 'duplicate']) test(`production scope refuses ${kind} evidence`, () => {
  const f = fixture();
  if (kind === 'missing') f.records.pop();
  if (kind === 'account') f.account = 'foreign';
  if (kind === 'issuer') f.descriptors[0].auth.issuer = 'https://foreign.invalid';
  if (kind === 'endpoint') f.records[0].url = 'https://foreign.invalid/mcp';
  if (kind === 'duplicate') f.records.push({ ...f.records[0], key: 'duplicate' });
  assert.throws(() => resolveSmartProductionScope(f), { code: 'SMART_ENTERPRISE_GROUP_UNAVAILABLE' });
});

test('two complete grants in the same account require disambiguation instead of merging accounts or guessing', () => {
  const f = fixture();
  f.grants.set('second-grant', { grant: { account: 'default', issuer: 'https://agent.qcc.com' } });
  f.records.push(...f.records.map((record) => ({ ...record, key: `${record.key}-other`, auth: { mode: 'oauth', grantKey: 'second-grant' } })));
  assert.throws(() => resolveSmartProductionScope(f), { code: 'SMART_ENTERPRISE_GROUP_AMBIGUOUS' });
  f.grants.get('second-grant').grant.account = 'foreign';
  assert.equal(resolveSmartProductionScope(f).accountRef, 'synthetic-grant-a');
});

test('normal Host adapter rejects an absent profile and an unverified installed version before opening smart storage', async (t) => {
  await assert.rejects(loadSmartModeHost({}), { code: 'SMART_HOST_PROFILE_REQUIRED' });
  const path = await temporaryProfile(t), moduleDir = join(path, 'node_modules', '@deepseek-ai', 'dsh-agent-loop');
  await fs.mkdir(moduleDir, { recursive: true });
  await fs.writeFile(join(moduleDir, 'package.json'), JSON.stringify({ version: '0.0.0-unverified', main: 'index.js' }));
  await fs.writeFile(join(moduleDir, 'index.js'), '/* synthetic version-only fixture */');
  await assert.rejects(loadSmartModeHost({ profileContext: { dir: path, installAnchor: join(path, 'package.json') } }),
    { code: 'SMART_HOST_VERSION_UNVERIFIED' });
  await assert.rejects(fs.stat(join(path, 'storages')), { code: 'ENOENT' });
});
