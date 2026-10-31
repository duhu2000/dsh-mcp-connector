// Disposable real-browser UI test. No user profile or provider calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = spawn(process.execPath, ['scripts/ui-harness.mjs'], {
  env: { ...process.env, MCP_CONNECTOR_UI_PORT: '0', MCP_CONNECTOR_UI_CATALOG_PATH: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Harness timeout')), 15000);
    server.once('exit', () => { clearTimeout(timeout); reject(Error('Harness exited')); });
    server.stdout.on('data', (data) => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.request.post(`${base}/mcp-connector/api`, { data: { method: 'connect', params: { connectorId: 'qcc-company' } } });
  await page.goto(base);
  const frame = page.frameLocator('iframe');
  await frame.locator('.card').first().waitFor();
  await frame.getByRole('button', { name: /已安装/ }).click();
  // Supply a second public mock workspace through the same Host context message.
  await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({
    type: 'mcp-connector:workspace-context',
    workspace: { workspaceId: 'workspace-mock', title: '无凭据验收项目' },
    workspaces: [{ workspaceId: 'workspace-mock', title: '无凭据验收项目' }, { workspaceId: 'workspace-second', title: '第二项目' }],
  }, location.origin));
  await frame.getByRole('button', { name: '范围', exact: true }).first().click();
  await frame.locator('#scope-change-target').selectOption('project');
  await frame.getByRole('button', { name: '预览并应用', exact: true }).click();
  await frame.locator('#modal-error').filter({ hasText: '至少选择' }).waitFor();
  const boxes = frame.locator('[data-scope-workspace]');
  assert.equal(await boxes.count(), 2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await frame.getByRole('button', { name: '预览并应用', exact: true }).click();
  await frame.getByRole('button', { name: '应用', exact: true }).click();
  await frame.locator('#modalMask.show').waitFor({ state: 'hidden' });
  await frame.getByRole('button', { name: '范围', exact: true }).first().click();
  assert.equal(await frame.locator('[data-scope-workspace]:checked').count(), 2);
  assert.equal(await frame.locator('#scope-change-target').inputValue(), 'project');
  assert.deepEqual(errors, []);
  console.log('PASS: empty selection rejected; two workspaces applied and restored in real browser (Mock API only).');
} finally {
  await browser?.close();
  server.kill();
}
