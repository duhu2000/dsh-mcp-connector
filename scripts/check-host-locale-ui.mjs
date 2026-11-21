// Disposable Chromium with intercepted fixtures only; never connects to a DSH profile.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const playwrightSpecifier = process.env.PLAYWRIGHT_MODULE
  ? (process.env.PLAYWRIGHT_MODULE.startsWith('file:') ? process.env.PLAYWRIGHT_MODULE : pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
  : 'playwright';
const { chromium } = await import(playwrightSpecifier);
const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
// Observe stale as well as current completions inside the panel's private closure.
const explorerHtml = html.replace('  function finishViewRender(render) {', `  function finishViewRender(render) {
    window.__fixtureFinished = (window.__fixtureFinished || 0) + 1;
    window.dispatchEvent(new Event('fixture:render-finished'));`);
assert.notEqual(explorerHtml, html, 'render completion instrumentation must match the source');
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

async function panel(check, { source = html, explorer } = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  check.after(() => page.close());
  page.setDefaultTimeout(10000);
  const errors = [], calls = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) {
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<iframe style="width:100%;height:700px;border:0" src="/mcp-connector/ui/"></iframe>' });
      if (url.pathname === '/mcp-connector/ui/') return route.fulfill({ contentType: 'text/html', body: source });
      if (url.pathname === '/mcp-connector/api') {
        const { method, params } = route.request().postDataJSON();
        calls.push(method);
        if (Object.hasOwn(responses, method)) {
          if (method === 'toolExplorer' && explorer) return explorer(route, params);
          return route.fulfill({ json: { ok: true, detail: responses[method] } });
        }
        unexpected.push(`RPC ${method}`);
      } else if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
      else if (url.pathname === '/mcp-connector/smart-control/capabilities') return route.fulfill({ json: { enabled: false } });
      else if (url.pathname === '/mcp-connector/events') return route.fulfill({ status: 204 });
      else unexpected.push(url.pathname);
    } else unexpected.push(url.origin);
    return route.abort();
  });
  await page.goto(base);
  const frame = page.frameLocator('iframe');
  await frame.locator('.card').first().waitFor();
  const settled = () => frame.locator('html').evaluate(() => new Promise(resolve => {
    let remaining = 4;
    const next = () => --remaining ? requestAnimationFrame(next) : resolve();
    requestAnimationFrame(next);
  }));
  const send = async locale => {
    await page.evaluate(value => document.querySelector('iframe').contentWindow.postMessage({ type: 'mcp-connector:host-locale', locale: value }, location.origin), locale);
    await settled();
  };
  const verify = () => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); };
  return { frame, calls, send, settled, verify };
}

try {
  await test('live Host switches preserve list scroll, editor drafts and explicit overrides', { timeout: 30000 }, async check => {
    const { frame, calls, send, settled, verify } = await panel(check);
    const samples = [];
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
    await send('en');
    assert.equal(await frame.locator('html').getAttribute('lang'), 'zh-CN');
    assert.equal(await frame.locator('#import-json').inputValue(), '{"draft":"fixture-only"}');
    await frame.locator('#modalMask').click({ position: { x: 2, y: 80 } });
    await frame.locator('html[lang="en"]').waitFor();
    await frame.locator('#ui-language button[data-locale="en"]').click();
    await send('zh-CN');
    assert.equal(await frame.locator('html').getAttribute('lang'), 'en', 'active language button pins override');
    assert.match(await frame.locator('html').evaluate(() => location.search), /uiLocale=en/);
    verify();
    console.log(JSON.stringify({ browser: browser.version(), samples, editorPreserved: true, explicitOverridePreserved: true }));
  });

  await test('Installed scroll is captured before language-dependent layout changes', { timeout: 15000 }, async check => {
    const { frame, calls, send, settled, verify } = await panel(check);
    await frame.locator('[data-view="installed"]').click();
    await frame.locator('.row').first().waitFor();
    // Trigger real browser scroll anchoring independently of the machine's font fallback.
    await frame.locator('html').evaluate(() => {
      const style = document.createElement('style');
      style.textContent = 'html:lang(en) .stats { margin-bottom:22px }';
      document.head.append(style);
    });
    await frame.locator('#main').evaluate(el => { el.scrollTop = 600; });
    await settled();
    assert.equal(await frame.locator('#main').evaluate(el => el.scrollTop), 600);
    const count = calls.length, samples = [];
    for (const locale of ['en', 'zh-CN', 'en', 'zh-CN']) {
      await send(locale);
      await frame.locator(`html[lang="${locale}"]`).waitFor();
      const scroll = await frame.locator('#main').evaluate(el => el.scrollTop);
      samples.push({ locale, scroll });
      assert.equal(scroll, 600, `Installed language-dependent layout: ${locale}`);
      assert.equal(calls.length, count);
    }
    verify();
    console.log(JSON.stringify({ browser: browser.version(), layoutShiftSamples: samples }));
  });

  for (const order of [[1, 0], [0, 1]]) {
    await test(`Explorer request completion order ${order.join(',')} keeps current labels and data`, { timeout: 15000 }, async check => {
      const pending = [], waiters = [];
      const requested = index => pending[index] ? Promise.resolve(pending[index]) : new Promise(resolve => { waiters[index] = resolve; });
      const { frame, calls, send, verify } = await panel(check, {
        source: explorerHtml,
        explorer(route, params) {
          const index = pending.length;
          pending.push({ route, params });
          waiters[index]?.(pending[index]);
        },
      });
      await frame.locator('[data-view="tools"]').click();
      await requested(0);
      assert.equal(await frame.locator('[data-explorer-clear]').innerText(), '清除筛选');
      const count = calls.length;
      await send('en');
      await frame.locator('html[lang="en"]').waitFor();
      assert.equal(calls.length, count, 'switch alone must not fetch');
      await frame.locator('#search').fill('fixture');
      await requested(1);
      assert.equal(pending[0].params.query, '');
      assert.equal(pending[1].params.query, 'fixture');
      await frame.locator('html').evaluate(() => { window.__fixtureFinished = 0; });
      let completed = 0;
      for (const index of order) {
        const detail = { ...responses.toolExplorer, items: [{ ...responses.toolExplorer.items[0], name: index ? 'newest_fixture_tool' : 'obsolete_tool' }] };
        completed++;
        await frame.locator('html').evaluate(count => {
          window.__fixtureCompletion = new Promise(resolve => {
            const finished = () => {
              if (window.__fixtureFinished < count) return;
              window.removeEventListener('fixture:render-finished', finished);
              resolve();
            };
            window.addEventListener('fixture:render-finished', finished);
            finished();
          });
        }, completed);
        await pending[index].route.fulfill({ json: { ok: true, detail } });
        await frame.locator('html').evaluate(() => window.__fixtureCompletion);
        if (index === 1 || order[0] === 1) {
          assert.equal(await frame.locator('[data-explorer-clear]').innerText(), 'Clear filters');
          assert.equal(await frame.locator('#explorer-connection').getAttribute('aria-label'), 'Filter by connection');
          assert.equal(await frame.locator('[data-explorer-page="next"]').innerText(), 'Next');
          assert.equal(await frame.locator('#explorer-results article strong').innerText(), 'newest_fixture_tool');
          assert.equal(await frame.locator('#search').inputValue(), 'fixture');
        }
      }
      assert.equal(pending.length, 2);
      verify();
      console.log(JSON.stringify({ browser: browser.version(), completionOrder: order, requests: pending.length }));
    });
  }
} finally {
  await browser.close();
}
