// Disposable Chromium with intercepted fixtures only; never connects to a DSH profile.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const base = 'http://127.0.0.1:41879';
const catalog = Array.from({ length: 40 }, (_, i) => ({ id: `fixture-${i}`, name: `Fixture ${i}`, category: '金融投资', authMode: 'none', servers: [], connected: [] }));
const installed = catalog.map(item => ({ key: item.id, name: item.name, serverName: 'fixture-server', enabled: true, connectionState: 'healthy', authMode: 'manual' }));
const connection = { connectionKey: 'fixture', connectionName: 'Fixture', connectorName: 'Fixture', serverName: 'fixture-server', status: 'success', toolCount: 40 };
const responses = {
  catalog: { items: catalog }, status: { items: installed, scope: { revision: 0 } }, migrationPreview: { pendingCount: 0 },
  toolExplorer: { connections: [connection], selectedConnections: [connection], total: 40, scopeLabel: 'Fixture',
    items: Array.from({ length: 20 }, (_, i) => ({ name: `fixture_tool_${i}`, title: `Fixture ${i}`, connection, serverName: 'fixture-server' })) },
};
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [], calls = [], samples = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<iframe style="width:100%;height:700px;border:0" src="/mcp-connector/ui/"></iframe>' });
    if (url.pathname === '/mcp-connector/ui/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/mcp-connector/api') {
      const { method } = route.request().postDataJSON();
      calls.push(method);
      return route.fulfill({ json: { ok: true, detail: responses[method] ?? {} } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(base);
  const frame = page.frameLocator('iframe');
  await frame.locator('.card').first().waitFor();
  const send = locale => page.evaluate(value => document.querySelector('iframe').contentWindow.postMessage({ type: 'mcp-connector:host-locale', locale: value }, location.origin), locale);
  const settled = () => frame.locator('html').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const originalUrl = await frame.locator('html').evaluate(() => location.href);
  for (const view of ['market', 'installed', 'tools']) {
    if (view === 'market') await frame.locator('[data-category-filter="金融投资"]').click();
    else await frame.locator(`[data-view="${view}"]`).click();
    const selector = view === 'market' ? '.card' : view === 'installed' ? '.row' : '#explorer-results article';
    await frame.locator(selector).first().waitFor();
    if (view === 'tools') await frame.locator('#explorer-connections details').evaluate(el => { el.open = true; });
    await frame.locator('#main').evaluate(el => { el.scrollTop = 600; });
    await settled();
    const before = await frame.locator('#main').evaluate(el => el.scrollTop);
    assert.equal(before, 600, `${view}: fixture must be scrollable`);
    const count = calls.length;
    for (const locale of ['en', 'zh-CN', 'en', 'zh-CN']) {
      await send(locale);
      await frame.locator(`html[lang="${locale}"]`).waitFor();
      await settled();
      const scroll = await frame.locator('#main').evaluate(el => el.scrollTop);
      assert.equal(scroll, before, `${view}: ${locale} scroll`);
      assert.equal(calls.length, count, `${view}: no language-only API calls`);
      assert.equal(await frame.locator('html').evaluate(() => location.href), originalUrl);
      if (view === 'tools') {
        assert.equal(await frame.locator('#explorer-connections details').evaluate(el => el.open), true);
        assert.equal(await frame.locator('#explorer-pages button').first().innerText(), locale === 'en' ? 'Previous' : '上一页');
      }
      samples.push({ view, locale, scroll, additionalRequests: calls.length - count });
    }
  }
  await frame.locator('html').evaluate(() => window.__mcp.openAdd('json'));
  await frame.locator('#import-json').fill('{"draft":"fixture-only"}');
  await send('en'); await settled();
  assert.equal(await frame.locator('html').getAttribute('lang'), 'zh-CN');
  assert.equal(await frame.locator('#import-json').inputValue(), '{"draft":"fixture-only"}');
  await frame.locator('#modalMask').click({ position: { x: 2, y: 80 } });
  await frame.locator('html[lang="en"]').waitFor();
  await frame.locator('[data-locale="en"]').click();
  await send('zh-CN'); await settled();
  assert.equal(await frame.locator('html').getAttribute('lang'), 'en', 'active language button pins override');
  assert.match(await frame.locator('html').evaluate(() => location.search), /uiLocale=en/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), samples, editorPreserved: true, explicitOverridePreserved: true, pageErrors: errors }, null, 2));
} finally {
  await browser.close();
}
