#!/usr/bin/env node
import { handleCliBridgeRequest } from '../lib/cli-providers.js';

function providerFromArgs(argv) {
  const index = argv.indexOf('--provider');
  if (index < 0) return 'dingtalk-dws';
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new Error('--provider requires a value');
  return value;
}

const providerId = providerFromArgs(process.argv.slice(2));
let buffer = '';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const index = buffer.indexOf('\n');
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    Promise.resolve()
      .then(() => handleCliBridgeRequest(JSON.parse(line), { providerId }))
      .then((response) => { if (response) send(response); })
      .catch((error) => send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: String(error?.message ?? error) },
      }));
  }
});
