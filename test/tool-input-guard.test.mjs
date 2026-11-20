import test from 'node:test';
import assert from 'node:assert/strict';
import { inputShapeError, createToolInputGuard } from '../lib/tool-input-guard.js';
import { nestedArgumentsSchema as schema } from '../fixtures/nested-arguments.mjs';

test('DZH nested arguments: reject both observed failures and preserve valid input', () => {
  for (const value of [true, false]) {
    assert.equal(inputShapeError(schema, { param: value, stockCode: value }), 'arguments.param: expected object');
  }
  assert.equal(inputShapeError(schema, { stockCode: 'SH601519' }), 'arguments.param: required');
  assert.equal(inputShapeError(schema, { param: { stockCode: false } }), 'arguments.param.stockCode: expected string');
  assert.equal(inputShapeError(schema, { param: { stockCode: 'SH601519', getF10BusiinfoData: true } }), 'arguments.param.getF10BusiinfoData: expected object');
  const input = { param: { stockCode: 'SH601519', getF10Information: false, getF10BusiinfoData: { typeStyle: 1 } } };
  const before = structuredClone(input);
  assert.equal(inputShapeError(schema, input), undefined);
  assert.deepEqual(input, before);
});

test('structural guard preserves optional fields, arrays, null unions and unsupported schemas', () => {
  assert.equal(inputShapeError(schema, { param: { stockCode: 'SH601519' } }), undefined);
  assert.match(inputShapeError({ type: 'array', items: { type: 'integer' } }, [1, 1.5]), /\[1\]: expected integer/);
  for (const spec of [{ type: ['string', 'null'] }, { type: 'string', nullable: true }]) {
    assert.equal(inputShapeError(spec, null), undefined);
  }
  for (const spec of [{ $ref: '#/$defs/A' }, { anyOf: [{ type: 'string' }] }, { oneOf: [] }, { allOf: [] }]) {
    assert.equal(inputShapeError(spec, false), undefined);
  }
});

test('only owned visible tools; reads live schema; no secret values in errors; disposes', () => {
  let guard;
  let definition = { parameters: schema };
  let disposed = false;
  const agent = {};
  const ctx = { tools: {
    guard(fn) { guard = fn; return () => { disposed = true; }; },
    get(name, scope) { assert.equal(scope, agent); return definition; },
  } };
  const controller = createToolInputGuard(ctx, { isManagedTool: (name) => name === 'owned' });
  const run = (name, args) => guard({ name, arguments: args, agent });
  assert.equal(run('outside', { param: false }), undefined);
  const error = run('owned', { param: 'secret-never-echo' });
  assert.match(error, /MCP_INPUT_SHAPE_INVALID/);
  assert.ok(!error.includes('secret-never-echo'));
  definition = { parameters: { type: 'object', properties: { param: { type: 'string' } } } };
  assert.equal(run('owned', { param: 'valid' }), undefined);
  definition = undefined;
  assert.equal(run('owned', { param: false }), undefined);
  controller.dispose();
  assert.equal(disposed, true);
  assert.equal(createToolInputGuard({}).supported, false);
});
