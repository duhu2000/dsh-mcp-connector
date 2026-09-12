const DEFAULT_EVENT_TYPES = new Map([
  ['connect', 'connections'],
  ['configure', 'connections'],
  ['importJson', 'connections'],
  ['installFromUrl', 'connections'],
  ['renameConnection', 'connections'],
  ['reconfigureConnection', 'connections'],
  ['setEnabled', 'connections'],
  ['disconnect', 'connections'],
  ['migrateLegacy', 'connections'],
  ['restoreSnapshot', 'connections'],
  ['refreshCatalog', 'catalog'],
  ['publish', 'catalog'],
  ['healthCheck', 'status'],
  ['toolsList', 'tools'],
  ['applyPolicy', 'governance'],
  ['rollbackPolicy', 'governance'],
  ['applyConnectionScope', 'scope'],
  ['rollbackConnectionScope', 'scope'],
]);

const ALLOWED_EVENT_TYPES = new Set(['connections', 'catalog', 'status', 'tools', 'governance', 'scope']);

/**
 * 同源 Web UI 的轻量 SSE 事件总线。
 * 事件只包含类别、序号与时间，禁止携带连接标识、端点、错误或凭据。
 */
export class StatusEventHub {
  constructor({ heartbeatMs = 30_000, maxClients = 16 } = {}) {
    this.heartbeatMs = heartbeatMs;
    this.maxClients = maxClients;
    this.clients = new Set();
    this.sequence = 0;
    this.timer = null;
  }

  subscribe(req, res) {
    if (this.clients.size >= this.maxClients) return false;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.flushHeaders?.();
    const client = { res };
    this.clients.add(client);
    const close = () => this.remove(client);
    req?.on?.('close', close);
    res?.on?.('close', close);
    this.write(client, 'ready', { sequence: this.sequence, at: Date.now() });
    this.ensureHeartbeat();
    return true;
  }

  publish(type) {
    if (!ALLOWED_EVENT_TYPES.has(type)) throw new Error(`unsupported status event type: ${type}`);
    const payload = { type, sequence: ++this.sequence, at: Date.now() };
    for (const client of [...this.clients]) this.write(client, 'status', payload);
    return payload;
  }

  write(client, event, payload) {
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      this.remove(client);
    }
  }

  ensureHeartbeat() {
    if (this.timer || this.clients.size === 0) return;
    this.timer = setInterval(() => {
      for (const client of [...this.clients]) {
        try {
          client.res.write(`: ping ${Date.now()}\n\n`);
        } catch {
          this.remove(client);
        }
      }
    }, this.heartbeatMs);
    this.timer.unref?.();
  }

  remove(client) {
    this.clients.delete(client);
    if (this.clients.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const { res } of this.clients) res.end?.();
    this.clients.clear();
  }
}

/** 在既有 API 外层发布通用状态类别，不把 API 参数或返回值写入事件。 */
export function observeStatusEvents(api, eventHub, eventTypes = DEFAULT_EVENT_TYPES) {
  return new Proxy(api, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      const eventType = eventTypes.get(property);
      if (typeof value !== 'function' || !eventType) return value;
      return async (...args) => {
        try {
          return await Reflect.apply(value, target, args);
        } finally {
          if (!(property === 'toolsList' && args[2] === true)) eventHub.publish(eventType);
        }
      };
    },
  });
}
