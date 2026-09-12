import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { observeStatusEvents, StatusEventHub } from '../lib/status-events.js';

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.status = 0;
    this.headers = {};
    this.body = '';
    this.ended = false;
  }
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }
  write(chunk) {
    this.body += String(chunk);
    return true;
  }
  end() {
    this.ended = true;
  }
}

test('SSE 只发送通用状态类型、序号和时间', () => {
  const hub = new StatusEventHub({ heartbeatMs: 60_000 });
  const req = new EventEmitter();
  const res = new FakeResponse();
  assert.equal(hub.subscribe(req, res), true);
  const payload = hub.publish('connections');
  assert.deepEqual(Object.keys(payload).sort(), ['at', 'sequence', 'type']);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  assert.match(res.body, /event: ready/);
  assert.match(res.body, /event: status/);
  assert.doesNotMatch(res.body, /token|endpoint|connectorId/i);
  req.emit('close');
  assert.equal(hub.clients.size, 0);
  hub.dispose();
});

test('API 观察层在成功和失败后发布事件，但不暴露参数或返回值', async () => {
  const published = [];
  const hub = { publish(type) { published.push(type); } };
  const secret = 'sensitive-value';
  const api = observeStatusEvents({
    async configure(input) { return { ok: true, secret: input.secret }; },
    async healthCheck() { throw new Error(secret); },
    async catalog() { return { ok: true }; },
  }, hub);
  assert.equal((await api.configure({ secret })).secret, secret);
  await assert.rejects(api.healthCheck(), new RegExp(secret));
  await api.catalog();
  assert.deepEqual(published, ['connections', 'status']);
  assert.doesNotMatch(JSON.stringify(published), new RegExp(secret));
});

test('SSE 限制并发客户端并拒绝未知事件类型', () => {
  const hub = new StatusEventHub({ maxClients: 1 });
  assert.equal(hub.subscribe(new EventEmitter(), new FakeResponse()), true);
  assert.equal(hub.subscribe(new EventEmitter(), new FakeResponse()), false);
  assert.throws(() => hub.publish('credentials'), /unsupported status event type/);
  hub.dispose();
});

test('SSE 驱动的只读工具视图不再次发布事件，避免刷新循环', async () => {
  const published = [];
  const api = observeStatusEvents({ async toolsList() { return { ok: true }; } }, { publish(type) { published.push(type); } });
  await api.toolsList('demo', 'workspace-1', true);
  assert.deepEqual(published, []);
  await api.toolsList('demo', 'workspace-1', false);
  assert.deepEqual(published, ['tools']);
});
