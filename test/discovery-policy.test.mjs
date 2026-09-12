import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDiscovery, discoveryDue, parseRetryAfter } from '../lib/discovery-policy.js';

test('成功发现每五分钟到期，普通故障指数退避并封顶，恢复重置', () => {
  const success = nextDiscovery(null, { ok: true }, 0);
  assert.equal(success.nextAt, 300_000);
  assert.equal(discoveryDue(success, 299_999), false);
  assert.equal(discoveryDue(success, 300_000), true);
  let plan = nextDiscovery(success, { ok: false }, 0);
  assert.equal(plan.nextAt, 30_000);
  plan = nextDiscovery(plan, { ok: false }, 0);
  assert.equal(plan.nextAt, 60_000);
  for (let i = 0; i < 20; i++) plan = nextDiscovery(plan, { ok: false }, 0);
  assert.equal(plan.nextAt, 900_000);
  assert.equal(nextDiscovery(plan, { ok: true }, 0).failures, 0);
});

test('限流遵守 Retry-After；鉴权失败暂停，无凭据的计划不产生重试', () => {
  assert.equal(parseRetryAfter('600', 0), 600_000);
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:10:00 GMT', 0), 600_000);
  assert.equal(parseRetryAfter('bad', 0), 0);
  assert.equal(parseRetryAfter('-1', 0), 0);
  assert.equal(nextDiscovery(null, { ok: false, errorKind: 'rate-limit', retryAfterMs: 600_000 }, 0).nextAt, 600_000);
  const auth = nextDiscovery(null, { ok: false, errorKind: 'auth' }, 0);
  assert.equal(discoveryDue(auth, Number.MAX_SAFE_INTEGER), false);
  assert.equal(discoveryDue(null, 0), true);
});

test('六条健康连接持续查看十分钟，后台请求轮数从 21 轮降为 3 轮', () => {
  let plan; let calls = 0;
  for (let now = 0; now <= 600_000; now += 30_000) {
    if (discoveryDue(plan, now)) { calls += 6; plan = nextDiscovery(plan, { ok: true }, now); }
  }
  assert.equal(calls, 18); // 0、5、10 分钟；原来每 30 秒是 126 次。
});
