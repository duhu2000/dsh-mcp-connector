// Real Chromium against a disposable Mock API. Never touches a DSH profile.
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
    server.stdout.on('data', data => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.request.post(base + '/mcp-connector/api', { data: { method: 'connect', params: { connectorId: 'qcc-company' } } });
  await page.goto(base);
  const frame = page.frameLocator('iframe');
  await frame.locator('.card').first().waitFor();
  assert.equal(await frame.locator('#tab-market').innerText(), '市场');
  await frame.locator('#ui-language').selectOption('en');
  await frame.locator('#tab-market').filter({ hasText: 'Market' }).waitFor();
  assert.equal(await frame.locator('html').getAttribute('lang'), 'en');
  await page.screenshot({ path: '/tmp/mcp-i18n-en.png' });
  await frame.locator('[data-view="installed"]').click();
  await frame.getByRole('button', { name: 'Local connection statistics', exact: true }).click();
  await frame.locator('#modal').filter({ hasText: 'Current profile only' }).waitFor();
  await frame.locator('#modalMask').click({ position: { x: 2, y: 2 } });
  await frame.locator('#first-use').click();
  await frame.getByRole('button', { name: 'Generate a safe connection template', exact: true }).click();
  await frame.getByRole('button', { name: 'Generate safe preview', exact: true }).waitFor();
  await frame.getByRole('button', { name: 'Generate safe preview', exact: true }).click();
  await frame.getByRole('button', { name: 'Copy JSON', exact: true }).waitFor();
  // Switching while editing requires explicit discard confirmation.
  await frame.locator('#ui-language').selectOption('zh-CN');
  await frame.locator('#confirmMask.show').waitFor();
  await frame.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await frame.locator('#ui-language').inputValue(), 'en');
  await frame.locator('#modalMask').click({ position: { x: 2, y: 2 } });
  await frame.locator('#first-use').click();
  await frame.getByRole('button', { name: 'Write about your experience', exact: true }).click();
  await frame.getByRole('button', { name: 'Generate preview', exact: true }).waitFor();
  await frame.locator('#modalMask').click({ position: { x: 2, y: 2 } });
  await frame.locator('#ui-language').selectOption('zh-CN');
  await frame.locator('#tab-market').filter({ hasText: '市场' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: Chinese/English switching, statistics, safe template, sharing, unsaved-edit confirmation; real browser / Mock API only.');
} finally {
  await browser?.close();
  server.kill();
}
