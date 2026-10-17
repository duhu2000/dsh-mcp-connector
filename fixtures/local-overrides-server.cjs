// Local-only acceptance fixture (not an automatic test): no network or file writes.
const { createInterface } = require('node:readline');

if (!process.argv.includes('--accept-local-overlay') || process.env.MCP_OVERLAY_FIXTURE !== 'synthetic-value') {
  process.exit(2);
}
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (!Object.hasOwn(request, 'id')) return;
  if (request.method === 'initialize') {
    reply(request.id, { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'local-overlay-fixture', version: '1' } });
  } else if (request.method === 'tools/list') {
    reply(request.id, { tools: [{ name: 'inspect_process', description: 'Inspect only synthetic test process settings', inputSchema: { type: 'object', properties: {} } }] });
  } else if (request.method === 'tools/call' && request.params.name === 'inspect_process') {
    reply(request.id, { content: [{ type: 'text', text: JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), value: process.env.MCP_OVERLAY_FIXTURE, pid: process.pid }) }] });
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method' } }) + '\n');
  }
});
