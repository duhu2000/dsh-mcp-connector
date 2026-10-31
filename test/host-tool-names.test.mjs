import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHostToolNames, supportsHostToolNames } from '../lib/host-tool-names.js';

test('prefer public definitions; never touch parameters, execution or the legacy view', () => {
  const definition = { name: 'mcp__a__read' };
  for (const key of ['parameters', 'execute', 'output', 'description']) {
    Object.defineProperty(definition, key, { get() { throw new Error('deep materialization'); } });
  }
  const tools = {
    definitions: () => [definition, definition],
    view() { throw new Error('must prefer public API'); },
    schemas() { throw new Error('must never call schemas'); },
  };
  assert.ok(supportsHostToolNames(tools));
  assert.deepEqual(readHostToolNames(tools), ['mcp__a__read']);
});

test('legacy adapter reads Map keys only and rejects changed Host contracts', () => {
  const visible = new Map([['mcp__b__write', null], ['mcp__a__read', null]]);
  const view = { visible, knownNames: new Set(visible.keys()), restrictableNames: new Set(visible.keys()) };
  const tools = { view: () => view, schemas() { throw new Error('no fallback'); } };
  assert.deepEqual(readHostToolNames(tools), ['mcp__a__read', 'mcp__b__write']);
  assert.equal(visible.size, 2, 'Host data is never mutated');
  view.visible = [];
  assert.throws(() => readHostToolNames(tools), /不兼容/);
});

test('unsupported or malformed readers fail explicitly instead of reviving the schema loop', () => {
  let called = 0;
  const tools = { schemas() { called++; return []; } };
  assert.equal(supportsHostToolNames(tools), false);
  assert.throws(() => readHostToolNames(tools), /不支持/);
  assert.equal(called, 0);
  assert.throws(() => readHostToolNames({ definitions: () => null }), /不兼容/);
  assert.throws(() => readHostToolNames({ definitions: () => [{ name: 1 }] }), /不兼容/);
});
