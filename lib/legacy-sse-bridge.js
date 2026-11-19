/** Bundled host adapter. URL and credentials are environment-only, never argv/logs. */
import { EnvHttpProxyAgent, fetch } from 'undici';
import { LegacySseSession } from './legacy-sse.js';

const dispatcher = new EnvHttpProxyAgent();
let session;
let stopping = false;
function stop(failed = false) {
  if (stopping) return;
  stopping = true;
  session?.close();
  if (failed) process.stderr.write('Legacy SSE connection failed; no automatic retry. Check endpoint, credentials and network.\n');
  void dispatcher.destroy().finally(() => process.exit(failed ? 1 : 0));
}
try {
  const config = JSON.parse(process.env.DSH_LEGACY_SSE_CONFIG ?? '{}');
  delete process.env.DSH_LEGACY_SSE_CONFIG;
  session = new LegacySseSession(config.url, {
    headers: config.headers,
    fetchImpl: (url, options) => fetch(url, { ...options, dispatcher }),
    onmessage: message => process.stdout.write(JSON.stringify(message) + '\n'),
    onerror: () => stop(true),
  });
} catch { stop(true); }

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) { stop(true); return; }
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      if (message?.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC');
      // Do not wait for a reply: server requests, notifications and cancellation must flow both ways.
      void session.send(message).catch(() => stop(true));
    } catch { stop(true); return; }
  }
});
process.stdin.on('end', () => stop());
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
