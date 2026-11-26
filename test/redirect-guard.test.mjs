import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPublicInstallUrl,
  isSameOrigin,
  resolveCredentialedRedirect,
} from '../lib/util.js';

function redirectTo(location, status = 302) {
  return new Response(undefined, { status, headers: { location } });
}

test('assertPublicInstallUrl 拒绝回环、私网与元数据端点', () => {
  const blocked = [
    'https://127.0.0.1/defs.json',
    'https://localhost/defs.json',
    'https://mymac.localhost/defs.json',
    'https://10.1.2.3/defs.json',
    'https://172.16.0.9/defs.json',
    'https://192.168.1.5/defs.json',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/defs.json',
    'https://[fd00::1]/defs.json',
    'http://example.com/defs.json',
  ];
  for (const url of blocked) {
    assert.throws(() => assertPublicInstallUrl(url), (error) => error?.code === 'INSTALL_URL_HOST_NOT_ALLOWED', url);
  }
});

test('assertPublicInstallUrl 放行公网 https', () => {
  assert.equal(assertPublicInstallUrl('https://cdn.example.com/defs.json').host, 'cdn.example.com');
});

test('同源判断忽略路径与查询，区分协议与端口', () => {
  assert.equal(isSameOrigin('https://a.example.com/x', 'https://a.example.com/y?z=1'), true);
  assert.equal(isSameOrigin('https://a.example.com/x', 'https://a.example.com:444/x'), false);
  assert.equal(isSameOrigin('https://a.example.com/x', 'http://a.example.com/x'), false);
  assert.equal(isSameOrigin('https://a.example.com/x', 'https://b.example.com/x'), false);
});

test('resolveCredentialedRedirect 只在同源且未超跳数时允许跟进', () => {
  const follow = resolveCredentialedRedirect(redirectTo('/v2/mcp'), 'https://a.example.com/mcp');
  assert.equal(follow.follow, true);
  assert.equal(follow.url, 'https://a.example.com/v2/mcp');

  assert.throws(
    () => resolveCredentialedRedirect(redirectTo('https://evil.example.net/collect'), 'https://a.example.com/mcp'),
    /拒绝跨源重定向/,
  );
  assert.throws(() => resolveCredentialedRedirect(redirectTo('/v2'), 'https://a.example.com/mcp', { maxHops: 1, hops: 1 }), /重定向次数超出上限/);
  assert.throws(() => resolveCredentialedRedirect(redirectTo('http://a.example.com/mcp'), 'https://a.example.com/mcp'), /拒绝跨源重定向/);
});

test('非 3xx 响应不触发跳转', () => {
  assert.equal(resolveCredentialedRedirect(new Response('{}', { status: 200 }), 'https://a.example.com/mcp').follow, false);
  assert.equal(resolveCredentialedRedirect(new Response(undefined, { status: 401 }), 'https://a.example.com/mcp').follow, false);
});
