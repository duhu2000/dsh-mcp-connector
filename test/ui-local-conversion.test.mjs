import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const start = html.indexOf("  const LOCAL_CONVERSION_STORAGE_KEY = 'mcp-connector.local-conversion-v1';");
const end = html.indexOf('\n  let view = ', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const source = html.slice(start, end);

function fixture({ initial, fail = false } = {}) {
  const values = new Map(initial ? [['mcp-connector.local-conversion-v1', initial]] : []);
  const localStorage = {
    getItem(key) { if (fail) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (fail) throw new Error('blocked'); values.set(key, value); },
  };
  const api = new Function('window', `${source}; return { readLocalConversion, recordLocalConversion, localConversionSnapshot };`)({ localStorage });
  return { ...api, values };
}

test('本机引导路径只保存聚合计数和去重后的公开连接器 ID', () => {
  const f = fixture();
  assert.equal(f.recordLocalConversion('quickStartOpened'), true);
  assert.equal(f.recordLocalConversion('quickStartOpened'), true);
  assert.equal(f.recordLocalConversion('recommendedOpened'), true);
  assert.equal(f.recordLocalConversion('connectionSucceeded', 'qcc-company'), true);
  assert.equal(f.recordLocalConversion('connectionSucceeded', 'qcc-company'), false);
  assert.equal(f.recordLocalConversion('toolDiscoverySucceeded', 'qcc-company'), true);
  assert.deepEqual(f.localConversionSnapshot(), {
    quickStartOpened: 2,
    recommendedOpened: 1,
    connectedConnectors: 1,
    discoveredConnectors: 1,
  });
  const stored = f.values.get('mcp-connector.local-conversion-v1');
  assert.doesNotMatch(stored, /token|credential|prompt|workspace|business/i);
});

test('损坏或不可用的 localStorage 安全降级，不影响连接流程', () => {
  const corrupt = fixture({ initial: '{bad json' });
  assert.deepEqual(corrupt.localConversionSnapshot(), {
    quickStartOpened: 0,
    recommendedOpened: 0,
    connectedConnectors: 0,
    discoveredConnectors: 0,
  });
  const blocked = fixture({ fail: true });
  assert.equal(blocked.recordLocalConversion('quickStartOpened'), false);
  assert.equal(blocked.recordLocalConversion('connectionSucceeded', 'qcc-company'), false);
  assert.equal(blocked.recordLocalConversion('unknown-stage'), false);
});

test('本机引导路径有固定上限，不接受空或超长连接器 ID', () => {
  const f = fixture({ initial: JSON.stringify({ quickStartOpened: 2_000_000, connectedConnectorIds: ['a', 'a', 3, ''] }) });
  assert.equal(f.readLocalConversion().quickStartOpened, 1_000_000);
  assert.deepEqual(f.readLocalConversion().connectedConnectorIds, ['a']);
  assert.equal(f.recordLocalConversion('connectionSucceeded', ''), false);
  assert.equal(f.recordLocalConversion('connectionSucceeded', 'x'.repeat(257)), false);
});
