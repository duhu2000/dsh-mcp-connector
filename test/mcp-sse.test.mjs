import test from 'node:test';
import assert from 'node:assert/strict';
import { readSseResponse } from '../lib/mcp-sse.js';
import { listMcpTools } from '../lib/mcp-http.js';
import { validateConnectionRecord } from '../lib/mcp-validation.js';

const record = { transport: 'streamable-http', url: 'https://mcp.example.com/mcp', auth: { mode: 'none' } };

for (const [lineEnding, blankEnding] of [
  ['\n', '\n'], ['\r\n', '\r\n'], ['\r', '\r'], ['\n', '\r\n'],
  ['\r\n', '\n'], ['\n', '\r'], ['\r\n', '\r'], ['\r', '\r\n'],
]) {
  test(`#218 shared SSE reader accepts ${JSON.stringify(lineEnding + blankEnding)} across UTF-8 byte fragments`, { timeout: 1000 }, async () => {
    let cancelled = 0;
    const fetchImpl = async (_url, options) => {
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      const request = JSON.parse(options.body);
      if (!request.id) return new Response(null, { status: 202 });
      const result = request.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: '中文服务' } }
        : { tools: [{ name: '中文工具' }] };
      const event = `: keepalive${lineEnding}data: {"jsonrpc":"2.0",${lineEnding}data: "id":${request.id},"result":${JSON.stringify(result)}}${lineEnding}${blankEnding}`;
      return new Response(new ReadableStream({
        start(controller) {
          options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
          for (const byte of new TextEncoder().encode(event)) controller.enqueue(Uint8Array.of(byte));
        },
        cancel() { cancelled += 1; },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
    const validation = await validateConnectionRecord(record, { fetchImpl, timeoutMs: 500 });
    assert.equal(validation.ok, true, JSON.stringify(validation));
    const listed = await listMcpTools(record, { fetchImpl, timeoutMs: 500, retryCount: 0 });
    assert.deepEqual(listed.tools, [{ name: '中文工具' }]);
    assert.equal(cancelled, 3);
  });
}

test('#218 SSE keeps event boundaries: ignores other ids, malformed data and incomplete EOF events', async () => {
  const response = new Response([
    'data: not-json\n\n',
    'data: {"jsonrpc":"2.0","method":"notifications/message"}\n\n',
    'data: {"jsonrpc":"2.0","id":99,"result":{}}\n\n',
    'data: {"jsonrpc":"2.0","id":1,"result":{}}\n',
  ].join(''));
  const result = await readSseResponse(response, { id: 1, maxBytes: 1024, tooLarge: () => new Error('oversized') });
  assert.equal(result.payload, undefined);
});

test('#218 SSE enforces response size and releases the stream on failure', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(17)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(readSseResponse(response, { id: 1, maxBytes: 16, tooLarge: () => new Error('oversized') }), /oversized/);
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

test('#218 SSE preserves matching errors without waiting for cancellation to finish', { timeout: 1000 }, async () => {
  const payload = { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'unauthorized' } };
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\r\n\n`)); },
    cancel() { return new Promise(() => {}); },
  }));
  assert.deepEqual((await readSseResponse(response, { id: 1, maxBytes: 1024, tooLarge: () => new Error('oversized') })).payload, payload);
  assert.equal(response.body.locked, false);
});
