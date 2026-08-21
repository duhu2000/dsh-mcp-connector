import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeConnector, validateRegistryDescriptors } from '../lib/probe.js';

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('registry 校验拒绝重复 serverName 与未知字段夹带的凭据', () => {
  const server = { serverKey: 'main', url: 'https://mcp.example.com/stream', serverName: 'shared' };
  assert.throws(() => validateRegistryDescriptors([
    { id: 'a', name: 'A', servers: [server] },
    { id: 'b', name: 'B', servers: [{ ...server, serverKey: 'other' }] },
  ]), /重复 serverName/);
  assert.throws(() => validateRegistryDescriptors([
    { id: 'a', name: 'A', token: 'must-not-enter-registry', servers: [server] },
  ]), /禁止携带凭证/);
});

test('OAuth 连接器公开元数据探针可判定 pass', async () => {
  let base;
  const { server, base: serverBase } = await listen((req, res) => {
    if (req.url === '/mcp' && req.method === 'POST') {
      res.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${base}/resource-metadata"` });
      res.end();
      return;
    }
    if (req.url === '/resource-metadata') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ resource: `${base}/mcp`, authorization_servers: [base] }));
      return;
    }
    if (req.url === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        revocation_endpoint: `${base}/revoke`,
      }));
      return;
    }
    res.writeHead(404); res.end();
  });
  base = serverBase;
  try {
    const report = await probeConnector({
      id: 'probe-pass',
      name: 'Probe Pass',
      icon: '⚖️',
      auth: { mode: 'oauth2-pkce', issuer: base },
      servers: [{ serverKey: 'main', url: `${base}/mcp`, serverName: 'probe-pass' }],
    }, { timeoutMs: 2000 });
    assert.equal(report.status, 'pass');
    assert.equal(report.icon.kind, 'text');
    assert.equal(report.servers[0].reachable, true);
    assert.equal(report.servers[0].oauth, 'pass');
  } finally {
    server.close();
  }
});

test('404 非 MCP 端点判定 fail', async () => {
  const { server, base } = await listen((_req, res) => { res.writeHead(404); res.end(); });
  try {
    const report = await probeConnector({
      id: 'probe-fail', name: 'Probe Fail', auth: { mode: 'none' },
      servers: [{ serverKey: 'main', url: `${base}/missing`, serverName: 'probe-fail' }],
    }, { timeoutMs: 1000 });
    assert.equal(report.status, 'fail');
  } finally {
    server.close();
  }
});
