import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Opt in with installed program files only. Never open the installation's profile/storage.
const cli = process.env.DSH_LEGACY_TEST_CLI;
const repo = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  { id: 'qcc-company', plugin: 'qcc-mcp-oauth', pkg: 'qcc-dsh-mcp-oauth', domain: 'qcc_mcp_oauth', key: 'company', oldKey: 'company' },
  { id: 'qcc-legal', plugin: 'qcc-legal-mcp-oauth', pkg: 'qcc-dsh-mcp-legal-oauth', domain: 'qcc_legal_mcp_oauth', key: 'case', oldKey: 'legal-case' },
];

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

test('isolated DSH web: both real legacy bundles, red cards, residual and restart recovery', { skip: !cli, timeout: 180_000 }, async (t) => {
  const modules = process.env.DSH_LEGACY_TEST_MODULES;
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const home = await mkdtemp(join(tmpdir(), 'dsh-legacy-acceptance-'));
  const profile = join(home, 'profiles', 'acceptance');
  const storage = join(home, 'storages');
  const scratchModules = join(profile, 'node_modules');
  await mkdir(scratchModules, { recursive: true });
  await mkdir(storage);
  const links = [];
  let host, stopped, browser;
  const credentials = new Map(cases.map((c) => [c.key, 'synthetic-' + c.key]));
  const mock = createServer(async (req, res) => {
    const key = req.url.slice(1);
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (!credentials.has(key) || req.headers.authorization !== 'Bearer ' + credentials.get(key)) {
      res.writeHead(401).end(); return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rpc = JSON.parse(Buffer.concat(chunks));
    if (rpc.id === undefined) { res.writeHead(202).end(); return; }
    const result = rpc.method === 'initialize'
      ? { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'migration-test', version: '1' } }
      : { tools: [{ name: 'echo_' + key, description: 'Local acceptance tool', inputSchema: { type: 'object' } }] };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  async function stopHost() {
    if (!host) return;
    host.kill();
    await stopped;
    host = null;
  }
  t.after(async () => {
    await browser?.close();
    await stopHost();
    mock.closeAllConnections();
    await new Promise((resolve) => mock.close(resolve));
    for (const link of links) await rm(link, { force: true });
    await rm(home, { recursive: true, force: true, maxRetries: 3 });
  });
  const issuer = 'http://127.0.0.1:' + await listen(mock);
  for (const c of cases) {
    const grant = {
      issuer, clientId: 'synthetic-client-' + c.key, clientName: 'Migration fixture', scope: 'mcp:tools',
      accessToken: credentials.get(c.key), accessTokenExpiresAt: Date.now() + 3_600_000,
      refreshToken: 'synthetic-refresh-' + c.key, authorizedResources: [issuer + '/' + c.key],
      entryResource: issuer + '/' + c.key, updatedAt: Date.now(),
    };
    await writeFile(join(storage, c.domain + '.json'), JSON.stringify({
      unit: { name: c.domain, version: 1 }, global: null, tables: { grants: { 'grant:default': grant } },
    }));
  }
  for (const [name, source] of [['dsh-mcp-connector', repo], ...cases.map((c) => [c.pkg, join(modules, c.pkg)])]) {
    const target = join(scratchModules, name);
    await symlink(await realpath(source), target, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(target);
  }
  const probe = join(scratchModules, 'migration-inspector');
  const inventory = join(home, 'host-inventory.json');
  await mkdir(probe);
  await writeFile(join(probe, 'package.json'), JSON.stringify({ name: 'migration-inspector', type: 'module', main: 'index.js' }));
  await writeFile(join(probe, 'index.js'), `
    import { renameSync, writeFileSync } from 'node:fs';
    export const inject = ['loader', 'timer', 'tools'];
    export function apply(ctx) {
      const inventoryPath = ${JSON.stringify(inventory)};
      ctx.setInterval(() => {
        const entries = [...ctx.loader.entries()].filter(e => e.options.id?.startsWith('mcp-qcc-') && !e.disabled && !e.options.disabled)
          .map(e => [e.options.id, e.options.config.serverName]);
        const names = ctx.tools.schemas().map(t => t.name).filter(n => n.endsWith('__echo_company') || n.endsWith('__echo_case'));
        writeFileSync(inventoryPath + '.tmp', JSON.stringify({ entries, names }));
        renameSync(inventoryPath + '.tmp', inventoryPath);
      }, 150);
    }`);
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...cases.map((c) => c.pkg), 'dsh-mcp-connector'];
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-acceptance', private: true, dsh: { profile: { bundles } } }));
  let base;
  async function call(method, params = {}) {
    const response = await fetch(base + '/mcp-connector/api', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(5000) });
    return response.json();
  }
  async function boot(disabled, legalResidual) {
    const overrides = cases.map((c) => ({ id: c.plugin, disabled, config: {
      issuer, autoConnectOnActivate: false, openBrowser: false, resources: { [c.oldKey]: issuer + '/' + c.key },
    } }));
    overrides.push({ insert: [{ id: 'migration-inspector', name: 'migration-inspector' }] });
    overrides.push({ id: 'mcp-connector', config: { catalogUrl: '', openBrowser: false, locale: 'zh-CN',
      connectors: cases.map((c) => ({ id: c.id, name: c.id, description: 'Isolated legacy migration', featured: true,
        auth: { mode: 'oauth2-pkce', issuer, scope: 'mcp:tools', clientName: 'Migration fixture' },
        servers: [{ serverKey: c.key, serverName: 'qcc-' + c.key, url: issuer + '/' + c.key, transport: 'streamable-http' }],
      })),
    } });
    if (legalResidual) overrides.push({ insert: [{ id: 'mcp-qcc-legal-case', name: '@deepseek-ai/dsh-mcp-client', disabled: legalResidual === 'disabled',
      config: { transport: 'streamable-http', serverName: 'legal-case', url: issuer + '/case', failOnStartupError: false },
    }] });
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(overrides));
    const portProbe = createServer();
    const port = await listen(portProbe);
    await new Promise((resolve) => portProbe.close(resolve));
    base = 'http://127.0.0.1:' + port;
    const env = { ...process.env, DSH_HOME: home };
    delete env.NODE_TEST_CONTEXT;
    host = spawn(process.execPath, [cli, '--profile', 'acceptance', '--port', String(port), '--no-open'], {
      cwd: home, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    stopped = once(host, 'exit');
    let output = '';
    for (const stream of [host.stdout, host.stderr]) stream.on('data', (chunk) => {
      output = (output + chunk.toString().replace(/([?&]token=)[^\s&]+/gi, '$1[redacted]')).slice(-1600);
    });
    for (let attempt = 0; attempt < 160; attempt++) {
      if (host.exitCode !== null) throw new Error('DSH exited: ' + output);
      if ((await call('status').catch(() => null))?.ok) return;
      await delay(200);
    }
    assert.fail('Isolated DSH API did not start: ' + output);
  }

  await boot(false);
  const migration = await call('migrateLegacy');
  assert.equal(migration.ok, true, migration.message);
  assert.deepEqual(migration.detail.pendingLegacyDisable.pluginIds.sort(), cases.map((c) => c.plugin).sort());
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE && { executablePath: process.env.CHROMIUM_EXECUTABLE }) });
  const page = await browser.newPage();
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(base + '/mcp-connector/ui/');
  for (const c of cases) {
    const cardData = (await call('catalog')).detail.items.find((item) => item.id === c.id);
    assert.equal(cardData?.diagnostic?.legacyConflict?.pluginId, c.plugin);
    await page.locator('#search').fill(c.id);
    const card = page.locator('.card[data-id="' + c.id + '"]').first();
    await card.waitFor({ timeout: 8000 });
    assert.match(await card.innerText(), /连接异常/);
    await card.getByRole('button', { name: '连接异常', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /旧插件|迁移|冲突/ });
    await dialog.waitFor();
    const instructions = await dialog.innerText();
    assert.ok(instructions.includes(c.pkg) && instructions.includes(c.plugin), instructions);
    assert.match(instructions, /重启|重新启动/);
    assert.ok(!instructions.includes(cases.find((other) => other !== c).pkg));
    await dialog.getByRole('button', { name: '知道了' }).click();
  }
  await page.locator('#search').fill('');
  await page.getByRole('button', { name: /^已安装/ }).click();
  const installed = page.locator('.row[data-key="qcc-legal-case"]');
  await installed.getByRole('button', { name: '查看处理步骤' }).click();
  const guide = page.getByRole('dialog', { name: /迁移|冲突/ });
  assert.match(await guide.innerText(), /qcc-dsh-mcp-legal-oauth/);
  await guide.getByRole('button', { name: '知道了' }).click();
  await page.getByRole('button', { name: '检测企查查旧授权' }).click();
  const scan = await guide.innerText();
  assert.ok(cases.every(c => scan.includes(c.pkg)));
  await guide.getByRole('button', { name: '知道了' }).click();
  const preview = await call('migrationPreview', { scanStored: true });
  assert.equal(preview.detail.pendingCount, 0);
  assert.equal(preview.detail.pendingLegacyDisable.conflicts.length, 2);
  for (const c of cases) {
    const key = c.id + '-' + c.key;
    assert.equal((await call('toolsList', { connectorId: c.id })).detail.diagnostic.code, 'conflict');
    assert.equal((await call('reconnect', { key })).ok, false);
  }
  const before = JSON.parse(await readFile(inventory, 'utf8'));
  assert.ok(before.entries.some(([id, name]) => id === 'mcp-qcc-company' && name === 'company'));
  assert.ok(before.entries.some(([id, name]) => id === 'mcp-qcc-legal-case' && name === 'legal-case'));
  assert.ok(!before.entries.some(([, name]) => ['qcc-company', 'qcc-case'].includes(name)));
  await stopHost();
  // Model a final rotation by the legacy owner between copying and disabling its bundle.
  const legalPath = join(storage, cases[1].domain + '.json');
  const legacyStorage = JSON.parse(await readFile(legalPath, 'utf8'));
  const latest = legacyStorage.tables.grants['grant:default'];
  credentials.set('case', 'synthetic-final-case');
  Object.assign(latest, { accessToken: credentials.get('case'), refreshToken: 'synthetic-final-refresh', updatedAt: Date.now() });
  await writeFile(legalPath, JSON.stringify(legacyStorage));
  await boot(true, 'active');
  const rows = (await call('status')).detail.items;
  const residual = rows.find((item) => item.connectorId === 'qcc-legal').diagnostic.legacyConflict;
  assert.equal(residual.kind, 'residual');
  assert.ok(residual.entryIds.some((id) => id.endsWith('mcp-qcc-legal-case')));
  assert.equal(rows.find((item) => item.connectorId === 'qcc-company').diagnostic?.legacyConflict, undefined);
  await stopHost();
  await boot(true, 'disabled');
  for (const c of cases) {
    const result = await call('toolsList', { connectorId: c.id });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.detail.connectionState, 'healthy');
    assert.ok(result.detail.servers[0].tools.some((tool) => tool.name === 'echo_' + c.key));
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const active = JSON.parse(await readFile(inventory, 'utf8'));
    if (cases.every(c => active.names.includes('mcp__qcc-' + c.key + '__echo_' + c.key))) return;
    await delay(100);
  }
  assert.fail('Recovered tools were not registered under both new Host names');
});
