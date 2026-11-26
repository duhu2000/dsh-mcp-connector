import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPublicInstallUrl,
  assertPublicServerUrl,
  assertPublicPeerAddress,
  classifyPublicV4,
  classifyPublicV6,
} from '../lib/util.js';
import { auditDescriptor, loadBundledCatalog } from '../lib/catalog.js';
import { normalizeConnectorDescriptor } from '../lib/schema.js';

function card(id, url, extra = {}) {
  return normalizeConnectorDescriptor({
    id,
    name: id,
    auth: { mode: 'none' },
    servers: [{ serverKey: 's1', serverName: `${id}-s1`, transport: 'streamable-http', url, ...extra }],
  });
}

const SERVER_BLOCKED = [
  ['内网 IPv4 整段 0/8', 'https://0.0.0.0/'],
  ['回环段 127.0.0.2（不再整体放行 127/8）', 'https://127.0.0.2/'],
  ['回环段 127.1.2.3', 'https://127.1.2.3/'],
  ['私网 10/8', 'https://10.0.0.5/mcp'],
  ['私网 172.16/12', 'https://172.20.1.1/mcp'],
  ['私网 192.168/16', 'https://192.168.1.9/mcp'],
  ['云元数据 metadata.google.internal', 'https://metadata.google.internal/'],
  ['云元数据 169.254.169.254', 'https://169.254.169.254/latest/meta-data/'],
  ['IPv4-mapped 私网', 'https://[::ffff:10.0.0.1]/'],
  ['IPv4-mapped 公网环回段 127.0.0.2', 'https://[::ffff:127.0.0.2]/'],
  ['IPv6 ULA', 'https://[fd00::1]/'],
  ['IPv6 链路本地', 'https://[fe80::1]/'],
  ['IPv6 NAT64 指向元数据', 'https://[64:ff9b::a9fe:a9fe]/'],
  ['IPv6 6to4 指向回环', 'https://[2002:7f00:1::]/'],
];

const SERVER_ALLOWED = [
  ['公网 IPv4 域名', 'https://mcp.example.com/mcp'],
  ['公网 IPv6 字面量', 'https://[2400:3200::1]/mcp'],
  ['公网 IPv6 字面量 2001:db8::1', 'https://[2001:db8::1]/'],
  ['回环 127.0.0.1', 'https://127.0.0.1:8443/mcp'],
  ['回环 localhost', 'http://localhost:8080/sse'],
  ['回环 ::1', 'https://[::1]/mcp'],
  ['IPv4-mapped 回环 ::ffff:127.0.0.1', 'https://[::ffff:127.0.0.1]/'],
  ['尾点 FQDN 的公网域名', 'https://mcp.example.com./mcp'],
];

test('assertPublicServerUrl 拒绝内网 / 元数据 / ULA / 链本地端点', () => {
  for (const [label, url] of SERVER_BLOCKED) {
    assert.throws(() => assertPublicServerUrl(url), (error) => error?.code === 'SERVER_URL_HOST_NOT_ALLOWED', label + ' ' + url);
  }
});

test('assertPublicServerUrl 放行公网 IPv6、回环与公网域名', () => {
  for (const [label, url] of SERVER_ALLOWED) {
    assert.ok(assertPublicServerUrl(url) instanceof URL, label + ' ' + url);
  }
});

test('assertPublicServerUrl 与 assertPublicInstallUrl 的回环 / 尾点标准一致', () => {
  // 0.0.0.0 与 127/8 非 .1 地址：两个入口都必须拒绝（此前 assertPublicServerUrl 全部放行 —— 标准漂移）。
  for (const url of ['https://0.0.0.0/', 'https://127.0.0.2/', 'https://127.255.255.254/']) {
    assert.throws(() => assertPublicServerUrl(url), (error) => error?.code === 'SERVER_URL_HOST_NOT_ALLOWED', url);
    assert.throws(() => assertPublicInstallUrl(url), (error) => error?.code === 'INSTALL_URL_HOST_NOT_ALLOWED', url);
  }
  // 尾点 FQDN 归一后与不带点等价：localhost. 必须按回环处理。
  assert.throws(() => assertPublicInstallUrl('https://localhost./defs.json'), (error) => error?.code === 'INSTALL_URL_HOST_NOT_ALLOWED');
  assert.throws(() => assertPublicInstallUrl('https://127.0.0.1./defs.json'), (error) => error?.code === 'INSTALL_URL_HOST_NOT_ALLOWED');
  assert.throws(() => assertPublicInstallUrl('https://metadata.google.internal./defs.json'), (error) => error?.code === 'INSTALL_URL_HOST_NOT_ALLOWED');
  assert.equal(assertPublicInstallUrl('https://mcp.example.com./defs.json').host, 'mcp.example.com.');
});

test('assertPublicInstallUrl 不再一律拒绝公网 IPv6 字面量', () => {
  assert.equal(assertPublicInstallUrl('https://[2400:3200::1]/defs.json').hostname, '[2400:3200::1]');
  assert.equal(assertPublicInstallUrl('https://[2001:db8::1]/defs.json').hostname, '[2001:db8::1]');
  for (const url of ['https://[::1]/defs.json', 'https://[fd00::1]/defs.json', 'https://[fe80::1]/defs.json', 'https://[64:ff9b::a9fe:a9fe]/defs.json']) {
    assert.throws(() => assertPublicInstallUrl(url), (error) => error?.code === 'INSTALL_URL_HOST_NOT_ALLOWED', url);
  }
});

test('assertPublicPeerAddress 按 RFC 6052 / RFC 3056 还原 NAT64 与 6to4', () => {
  // 公网内嵌地址：还原成 IPv4 后放行，并返回实际连接目标。
  assert.deepEqual(assertPublicPeerAddress('64:ff9b::808:808', 'https://x/'), { address: '8.8.8.8' });
  assert.deepEqual(assertPublicPeerAddress('2002:808:808::', 'https://x/'), { address: '8.8.8.8' });
  // 内网 / 元数据 / 回环内嵌地址：必须拒绝（此前被原样放行 —— IPv6 外壳绕过）。
  for (const address of ['64:ff9b::a9fe:a9fe', '64:ff9b::10.0.0.1', '2002:7f00:1::', '2002:a00:1::']) {
    assert.throws(() => assertPublicPeerAddress(address, 'https://x/'), (error) => error?.code === 'INSTALL_PEER_NOT_PUBLIC', address);
  }
  // 普通公网 IPv6 / IPv4 仍放行；回环 / ULA / 链本地仍拒绝。
  assert.deepEqual(assertPublicPeerAddress('2400:3200::1', 'https://x/'), { address: '2400:3200::1' });
  assert.deepEqual(assertPublicPeerAddress('8.8.8.8', 'https://x/'), { address: '8.8.8.8' });
  for (const address of ['::1', '::', 'fd00::1', 'fe80::1', '10.0.0.1', '127.0.0.1', '::ffff:127.0.0.1']) {
    assert.throws(() => assertPublicPeerAddress(address, 'https://x/'), (error) => error?.code === 'INSTALL_PEER_NOT_PUBLIC', address);
  }
});

test('classifyPublicV6 只放行全局单播与可还原的公网前缀', () => {
  assert.equal(classifyPublicV6('2400:3200::1').ok, true);
  assert.equal(classifyPublicV6('2001:db8::1').ok, true);
  assert.equal(classifyPublicV6('64:ff9b::808:808').ok, true);
  assert.equal(classifyPublicV6('2002:808:808::').ok, true);
  for (const address of ['::1', '::', 'fd00::1', 'fe80::1', 'ff02::1', '100::1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', 'fd00:ec2::254']) {
    assert.equal(classifyPublicV6(address).ok, false, address);
  }
  // 与 IPv4 判定保持同一标准：127/8 与 0/8 整段拒绝。
  assert.equal(classifyPublicV4('127.0.0.2').ok, false);
  assert.equal(classifyPublicV4('0.0.0.0').ok, false);
});

test('auditDescriptor 默认严格模式仍拦截不安全端点（远端卡片入口）', () => {
  assert.throws(() => auditDescriptor(card('strict-lan', 'https://10.0.0.5/mcp')), (error) => error?.code === 'SERVER_URL_HOST_NOT_ALLOWED');
  assert.throws(() => auditDescriptor(card('strict-meta', 'https://metadata.google.internal/')), (error) => error?.code === 'SERVER_URL_HOST_NOT_ALLOWED');
});

test('auditDescriptor tolerant 模式放行内网 / 公网 IPv6 卡片，只回调告警', () => {
  const LAN = card('lan-card', 'https://10.0.0.5/mcp');
  const V6 = card('v6-card', 'https://[2400:3200::1]/mcp');
  const OK = card('ok-card', 'https://mcp.example.com/mcp');
  // 内网卡片：不抛错，回调一次告警，卡片保留（加载期不得阻断）。
  const warnings = [];
  const kept = auditDescriptor(LAN, { tolerant: true, onEndpointRejected: (error, context) => warnings.push({ code: error.code, id: context?.descriptor?.id }) });
  assert.equal(kept, LAN);
  assert.deepEqual(warnings, [{ code: 'SERVER_URL_HOST_NOT_ALLOWED', id: 'lan-card' }]);
  // 公网 IPv6 卡片：根本不算不安全，不应触发任何告警。
  const noWarnings = [];
  assert.equal(auditDescriptor(V6, { tolerant: true, onEndpointRejected: (error) => noWarnings.push(error) }), V6);
  assert.equal(noWarnings.length, 0);
  // 正常卡片不受影响。
  assert.equal(auditDescriptor(OK, { tolerant: true }), OK);
  // tolerant 只降级端点判定：结构 / 密钥类违规仍然抛错。
  const secret = { ...card('bad-secret', 'https://mcp.example.com/mcp'), servers: [{ serverKey: 's', serverName: 's', transport: 'stdio', command: 'node', env: { API_TOKEN: 'x' } }] };
  assert.throws(() => auditDescriptor(secret, { tolerant: true }), /密钥类变量/);
});

test('内置目录全部卡片在严格模式下仍能通过审计（tolerant 不得放宽正式目录）', () => {
  for (const descriptor of loadBundledCatalog().filter((item) => item.published !== false)) {
    assert.doesNotThrow(() => auditDescriptor(descriptor), descriptor.id);
  }
});
