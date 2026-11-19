/** Legacy MCP HTTP+SSE transport. No reconnection or JSON-RPC replay. */
const MAX_EVENT_BYTES = 2 * 1024 * 1024;

function httpError(status) {
  const error = new Error(`Legacy SSE HTTP ${status}`);
  error.status = status;
  return error;
}

export class LegacySseSession {
  constructor(url, { headers = {}, fetchImpl = fetch, timeoutMs = 15_000, onmessage = () => {}, onerror = () => {} } = {}) {
    this.url = new URL(url);
    if (!['http:', 'https:'].includes(this.url.protocol) || this.url.username || this.url.password) throw new Error('Invalid SSE URL');
    this.headers = headers;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.onmessage = onmessage;
    this.onerror = onerror;
    this.controller = new AbortController();
    this.pending = new Map();
    this.sendQueue = Promise.resolve();
  }

  start() {
    if (this.closed) return Promise.reject(this.closed);
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => { this.ready = resolve; this.rejectReady = reject; });
    this.startTimer = setTimeout(() => this.close(new Error('SSE endpoint timeout')), this.timeoutMs);
    void this.consume().catch(error => this.close(error));
    return this.startPromise;
  }

  async consume() {
    const headers = new Headers(this.headers);
    headers.set('Accept', 'text/event-stream');
    const response = await this.fetchImpl(this.url.href, {
      method: 'GET', headers,
      signal: this.controller.signal, redirect: 'error',
    });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw httpError(response.status); }
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream') || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Expected legacy SSE event stream');
    }
    const reader = response.body.getReader();
    this.reader = reader;
    const decoder = new TextDecoder();
    let line = '', event = '', data = [], bytes = 0, skipLF = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Legacy SSE stream closed; requests were not retried');
        const text = decoder.decode(value, { stream: true });
        for (const char of text) {
          if (skipLF) { skipLF = false; if (char === '\n') continue; }
          bytes += Buffer.byteLength(char);
          if (bytes > MAX_EVENT_BYTES) throw new Error('Legacy SSE event exceeds size limit');
          if (char !== '\n' && char !== '\r') { line += char; continue; }
          skipLF = char === '\r';
          if (!line) {
            if (data.length) this.dispatch(event, data.join('\n'));
            event = ''; data = []; bytes = 0;
          } else if (!line.startsWith(':')) {
            const colon = line.indexOf(':');
            const field = colon < 0 ? line : line.slice(0, colon);
            const content = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (field === 'event') event = content;
            if (field === 'data') data.push(content);
          }
          line = '';
        }
      }
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  dispatch(event, data) {
    if (event === 'endpoint') {
      if (this.endpoint) throw new Error('Repeated legacy SSE endpoint');
      const endpoint = new URL(data, this.url);
      // Credentials must never follow a provider-controlled redirect or origin change.
      if (endpoint.origin !== this.url.origin || endpoint.username || endpoint.password || endpoint.hash) {
        throw new Error('Legacy SSE endpoint origin mismatch');
      }
      this.endpoint = endpoint.href;
      clearTimeout(this.startTimer);
      this.ready();
      return;
    }
    if (event && event !== 'message') return;
    let message;
    try { message = JSON.parse(data); } catch { throw new Error('Invalid legacy SSE JSON-RPC message'); }
    if (!message || message.jsonrpc !== '2.0') throw new Error('Invalid legacy SSE JSON-RPC message');
    if (!this.endpoint) throw new Error('Legacy SSE message received before endpoint');
    const pending = this.pending.get(message.id);
    if (pending && ('result' in message || 'error' in message)) {
      this.pending.delete(message.id);
      pending.resolve(message);
    } else this.onmessage(message);
  }

  send(message) {
    const sent = this.sendQueue.then(() => this.post(message));
    // A failed send terminates this session: never replay queued business requests.
    this.sendQueue = sent.catch(error => { this.close(error); });
    return sent;
  }

  async post(message) {
    await this.start();
    if (this.closed) throw this.closed;
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST', headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(message), redirect: 'error',
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(60_000)]),
    });
    // Legacy replies arrive on the GET stream; the POST body is an acknowledgement only.
    void response.body?.cancel().catch(() => {});
    if (!response.ok) throw httpError(response.status);
  }

  async request(message, signal) {
    const abort = () => this.close(signal?.reason instanceof Error ? signal.reason : new Error('Legacy SSE request aborted'));
    if (signal?.aborted) { abort(); throw this.closed; }
    signal?.addEventListener('abort', abort, { once: true });
    let timer;
    try {
      if (message.id === undefined) { await this.send(message); return undefined; }
      if (this.pending.has(message.id)) throw new Error('Duplicate JSON-RPC request id');
      const reply = new Promise((resolve, reject) => this.pending.set(message.id, { resolve, reject }));
      // Attach rejection handling before waiting for the HTTP acknowledgement.
      void reply.catch(() => {});
      timer = setTimeout(() => this.close(new Error('Legacy SSE request timeout')), 60_000);
      await this.send(message);
      return await reply;
    } finally {
      clearTimeout(timer);
      this.pending.delete(message.id);
      signal?.removeEventListener('abort', abort);
    }
  }

  close(error) {
    if (this.closed) return;
    this.closed = error ?? new Error('Legacy SSE session closed');
    clearTimeout(this.startTimer);
    this.controller.abort();
    void this.reader?.cancel().catch(() => {});
    this.rejectReady?.(this.closed);
    for (const pending of this.pending.values()) pending.reject(this.closed);
    this.pending.clear();
    if (error) this.onerror(error);
  }
}

/** Reuse the existing bounded initialize/tools-list checks for legacy sessions. */
export function legacySseFetch(url, fetchImpl) {
  let session;
  return {
    async fetch(_url, options) {
      session ??= new LegacySseSession(url, { headers: options.headers, fetchImpl });
      try {
        const reply = await session.request(JSON.parse(options.body), options.signal);
        return reply === undefined ? new Response(null, { status: 202 }) : Response.json(reply);
      } catch (error) {
        if (error.status) return new Response(null, { status: error.status });
        throw error;
      }
    },
    close() { session?.close(); },
  };
}
