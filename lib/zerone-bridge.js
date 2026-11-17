/** Tools-only stdio bridge for the two official Zerone query-auth endpoints. */
import { readSseResponse } from './mcp-sse.js';

const ENDPOINTS = Object.freeze({ pe: 'https://ai.zerone.com.cn/mcp/pe', base: 'https://ai.zerone.com.cn/mcp/base' });
const LIMIT = 2 * 1024 * 1024;

async function readPayload(response, id) {
  if (response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    return (await readSseResponse(response, { id, maxBytes: LIMIT, tooLarge: () => new Error('response limit') })).payload;
  }
  if (!response.body) throw new Error('empty response');
  const reader = response.body.getReader();
  let total = 0;
  const parts = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > LIMIT) throw new Error('response limit');
      parts.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

export function createZeroneBridge({ service, apiKey, fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
  if (!Object.hasOwn(ENDPOINTS, service)) throw new Error('Choose --service pe or base');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('ZERONE_API_KEY is required in the local environment');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid request timeout');
  const url = new URL(ENDPOINTS[service]);
  url.searchParams.set('api_key', apiKey);
  // No key in argv, emitted server identity, exception text, or on-disk state.
  const secrets = [...new Set([apiKey, encodeURIComponent(apiKey), new URLSearchParams({ k: apiKey }).toString().slice(2)])]
    .filter(Boolean).sort((a, b) => b.length - a.length);
  const scrubText = (text) => {
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
    return text;
  };
  const scrub = (value) => {
    if (typeof value === 'string') return scrubText(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [scrubText(key), scrub(item)]),
    );
    return value;
  };
  let sessionId;
  let protocolVersion;
  let phase = 'new';
  let remoteId = 0;
  const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  async function post(method, params, notification = false) {
    const id = notification ? undefined : ++remoteId;
    const response = await fetchImpl(url.toString(), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
    });
    if (!response.ok || response.status >= 300) {
      void response.body?.cancel().catch(() => {});
      throw new Error('remote request failed');
    }
    const nextSession = response.headers.get('mcp-session-id');
    if (nextSession) sessionId = nextSession;
    if (notification) {
      void response.body?.cancel().catch(() => {});
      return;
    }
    const payload = await readPayload(response, id);
    if (payload?.jsonrpc !== '2.0' || payload.id !== id || payload.error || !Object.hasOwn(payload, 'result')) {
      throw new Error('remote protocol error');
    }
    return payload.result;
  }

  return {
    async handle(request) {
      const id = request?.id;
      const hasId = id !== undefined;
      if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
        || (hasId && !(typeof id === 'string' || typeof id === 'number' && Number.isFinite(id)))) {
        return error(null, -32600, 'Invalid JSON-RPC request');
      }
      if (!hasId) {
        if (request.method === 'notifications/initialized' && phase === 'initialized') phase = 'ready';
        return undefined;
      }
      if (request.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
      try {
        if (request.method === 'initialize') {
          if (phase !== 'new') return error(id, -32600, 'Already initialized; start a new bridge session');
          if (typeof request.params?.protocolVersion !== 'string') return error(id, -32602, 'protocolVersion is required');
          phase = 'initializing';
          const result = await post('initialize', {
            protocolVersion: request.params.protocolVersion, capabilities: {},
            clientInfo: { name: 'dsh-zerone-bridge', version: '1.0.0' },
          });
          if (typeof result?.protocolVersion !== 'string' || !result.capabilities?.tools) throw new Error('unsupported upstream');
          protocolVersion = result.protocolVersion;
          await post('notifications/initialized', {}, true);
          phase = 'initialized';
          return scrub({ jsonrpc: '2.0', id, result: {
            protocolVersion, capabilities: { tools: {} },
            serverInfo: { name: `dsh-zerone-${service}-bridge`, version: '1.0.0' },
            instructions: 'Community tools-only bridge to the official Zerone service. Queries may be billable. No automatic retries. Use only tools within your account permissions.',
          } });
        }
        if (!['tools/list', 'tools/call'].includes(request.method)) return error(id, -32601, 'This bridge supports tools only');
        if (phase !== 'ready') return error(id, -32000, 'Initialize this session first');
        if (request.method === 'tools/call' && typeof request.params?.name !== 'string') return error(id, -32602, 'Tool name is required');
        const result = await post(request.method, request.params ?? {});
        return scrub({ jsonrpc: '2.0', id, result });
      } catch {
        if (phase === 'initializing') phase = 'failed';
        // Upstream errors or URLs can echo the key. Never expose them or retry.
        return error(id, -32000, 'Zerone request failed or timed out; no automatic retry. Check account access, quota and network.');
      }
    },
    async close() {
      phase = 'closed';
      if (!sessionId) return;
      try {
        const response = await fetchImpl(url.toString(), {
          method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(3_000),
          headers: { 'Mcp-Session-Id': sessionId, 'MCP-Protocol-Version': protocolVersion },
        });
        void response.body?.cancel().catch(() => {});
      } catch { /* Session cleanup is best effort and never retried. */ }
      sessionId = undefined;
    },
  };
}
