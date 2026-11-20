#!/usr/bin/env node
import { EnvHttpProxyAgent, fetch } from 'undici';
import { createQueryAuthBridge } from '../lib/query-auth-bridge.js';

const argv = process.argv.slice(2);
if (argv.length !== 0) {
  process.stderr.write('Usage: dsh-gildata-mcp-bridge (Token via GILDATA_API_KEY only)\n');
  process.exit(2);
}
const key = process.env.GILDATA_API_KEY;
delete process.env.GILDATA_API_KEY;
if (!key?.trim()) {
  process.stderr.write('Missing local credential: GILDATA_API_KEY\n');
  process.exit(2);
}
const dispatcher = new EnvHttpProxyAgent();
const bridge = createQueryAuthBridge({ profile: 'gildata-finquery', apiKey: key, fetchImpl: (url, options) => fetch(url, { ...options, dispatcher }) });
let buffer = '';
let chain = Promise.resolve();
const send = (message) => { if (message) process.stdout.write(JSON.stringify(message) + '\n'); };
const invalid = (code, message) => send({ jsonrpc: '2.0', id: null, error: { code, message } });
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 2_000_000) {
    process.stderr.write('MCP input limit exceeded\n');
    process.exit(2);
  }
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    chain = chain.then(async () => {
      let request;
      try { request = JSON.parse(line); } catch { invalid(-32700, 'Invalid JSON'); return; }
      send(await bridge.handle(request));
    }).catch(() => invalid(-32603, 'Bridge failure; no automatic retry'));
  }
});
process.stdin.on('end', () => {
  chain.then(() => bridge.close()).finally(() => dispatcher.close()).catch(() => {});
});
