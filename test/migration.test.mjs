import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLegacyGrantCandidates, planLegacyMigration, toConnectorGrant, toConnectionRecords } from '../lib/migration.js';
import { normalizeConnectorDescriptor } from '../lib/schema.js';

const legacy = {
  issuer: 'https://agent.qcc.com',
  clientId: 'legacy-client',
  scope: 'mcp:tools',
  accessToken: 'sensitive-access-token',
  accessTokenExpiresAt: Date.now() + 60_000,
  refreshToken: 'sensitive-refresh-token',
  authorizedResources: ['https://agent.qcc.com/mcp/company/stream'],
  entryResource: 'https://agent.qcc.com/mcp/company/stream',
  clientName: 'Legacy QCC',
  updatedAt: Date.now(),
};

test('旧插件迁移预览复用已打开 domain，且摘要不泄露 token', async () => {
  let openCalls = 0;
  const grants = new Map([['grant:default', legacy]]);
  const existing = { tables: new Map([['grants', { entries: () => grants.entries() }]]) };
  const storageDomain = {
    get(name) { return name === 'qcc_mcp_oauth' ? existing : undefined; },
    async open() {
      openCalls += 1;
      return { tables: new Map([['grants', { entries: () => [][Symbol.iterator]() }]]), close: async () => {} };
    },
  };
  const { candidates } = await readLegacyGrantCandidates(storageDomain, { openClosed: true });
  assert.equal(candidates.length, 1);
  assert.equal(openCalls, 1, '仅未打开的法律数据 domain 需要临时打开');

  const connector = normalizeConnectorDescriptor({
    id: 'qcc-company', name: '企查查·企业工商',
    auth: { mode: 'oauth2-pkce' },
    servers: [{ serverKey: 'company', url: legacy.entryResource, serverName: 'qcc-company' }],
  });
  const [plan] = planLegacyMigration(candidates, [connector], new Map());
  assert.equal(plan.summary.migratable, true);
  assert.doesNotMatch(JSON.stringify(plan.summary), /sensitive-/);

  const grant = toConnectorGrant(candidates[0], { key: 'grant:new', account: 'default', connectorIds: ['qcc-company'] });
  const records = toConnectionRecords(plan, grant.key);
  assert.equal(grant.accessToken, legacy.accessToken);
  assert.equal(records[0].auth.grantKey, 'grant:new');
  assert.equal(records[0].key, 'qcc-company-company');
});
