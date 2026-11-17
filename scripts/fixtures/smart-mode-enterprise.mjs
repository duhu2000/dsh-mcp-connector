import { publicToolName } from '../../lib/governance.js';
import { QCC_ENTERPRISE_SERVERS } from '../../lib/smart-mode-restrictions.js';

export function enterpriseFixture({ full = false } = {}) {
  const accountRef = 'synthetic-grant-a', groupId = 'enterprise-six';
  const records = QCC_ENTERPRISE_SERVERS.map((serverName, i) => ({
    key: `fixture-${i}`, connectorId: 'qcc-company', serverName, serverKey: serverName.slice(4),
    auth: { mode: 'oauth', grantKey: accountRef }, enabled: true, injectionMode: 'always',
  }));
  const scope = { accountRef, groupId, connections: records.map((record) => ({
    connectionKey: record.key, connectorId: record.connectorId, serverName: record.serverName,
    serverId: record.serverName,
  })) };
  const counts = full ? [158, 62, 37, 44, 36, 19] : [2, 1, 1, 1, 1, 1];
  const catalog = records.flatMap((record, i) => Array.from({ length: counts[i] }, (_, j) => ({
    connectionKey: record.key, publicName: publicToolName(record.serverName, j === counts[i] - 1 ? 'read/long fixture name '.repeat(4) : `fixture_read_${j}`),
    title: `Synthetic read ${i}/${j}`, description: 'Offline cached fixture capability',
  })));
  const businessNames = catalog.map((entry) => entry.publicName);
  const other = { key: 'other-account', connectorId: 'qcc-company', serverName: 'qcc-company-other', serverKey: 'company',
    auth: { mode: 'oauth', grantKey: 'synthetic-grant-b' }, enabled: true, injectionMode: 'always' };
  records.push(other);
  const outsideNames = [publicToolName(other.serverName, 'read'),
    ...Array.from({ length: full ? 10 : 1 }, (_, i) => `mcp__qcc_legal__fixture_${i}`),
    ...Array.from({ length: full ? 12 : 1 }, (_, i) => `mcp__fabao__fixture_${i}`),
    ...Array.from({ length: full ? 34 : 1 }, (_, i) => `fixture_host_${i}`)];
  const snapshot = (sessionId, mode = 'smart') => ({ version: 1, sessionId, mode,
    policyVersion: 'fixture-v1', selection: 'user-confirmed', ...(mode === 'smart' ? { accountRef, groupId } : {}) });
  return { records, scope, catalog, businessNames, outsideNames, snapshot };
}
