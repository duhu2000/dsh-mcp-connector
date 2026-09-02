import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealthSummary } from '../lib/diagnostics.js';

const record = {
  key: 'demo-main',
  connectorId: 'demo',
  serverKey: 'main',
  serverName: 'demo',
  enabled: true,
};

test('没有主动检查结果时诚实返回 unknown', () => {
  const summary = buildHealthSummary({
    connectorId: 'demo', records: [record], results: [], checkedAt: null,
  });
  assert.equal(summary.connectionState, 'unknown');
  assert.equal(summary.label, '状态未知');
  assert.equal(summary.checkedAt, null);
  assert.equal(summary.lastSuccessfulAt, null);
  assert.deepEqual(summary.diagnostic, {
    state: 'unknown',
    stage: 'host-observation',
    stageLabel: 'Host 状态观测',
    code: 'not-checked',
    message: '已保存配置，但本进程尚未观察到可用性检查结果',
    action: '运行健康检查以确认连接状态',
    checkedAt: null,
    lastSuccessfulAt: null,
  });
});

test('Host 无法确认 stdio 注册状态时保持 unknown', () => {
  const summary = buildHealthSummary({
    connectorId: 'demo',
    records: [record],
    results: [{
      ok: true,
      kind: 'managed',
      code: 'host-status-unavailable',
      serverKey: 'main',
      serverName: 'demo',
      message: '当前 Host 无法读取 stdio 工具注册状态',
    }],
    checkedAt: 200,
  });
  assert.equal(summary.connectionState, 'unknown');
  assert.equal(summary.diagnostic.stage, 'host-observation');
  assert.equal(summary.diagnostic.code, 'host-status-unavailable');
  assert.match(summary.diagnostic.action, /升级|重启/);
});

test('失败诊断包含阶段、稳定代码、建议并保留最近成功时间', () => {
  const healthy = buildHealthSummary({
    connectorId: 'demo',
    records: [record],
    results: [{ ok: true, kind: 'connected', serverKey: 'main', serverName: 'demo' }],
    checkedAt: 100,
  });
  const failed = buildHealthSummary({
    connectorId: 'demo',
    records: [record],
    results: [{ ok: false, kind: 'auth', serverKey: 'main', serverName: 'demo', message: 'HTTP 401' }],
    checkedAt: 200,
    previous: healthy,
  });
  assert.equal(failed.connectionState, 'reauth');
  assert.equal(failed.lastSuccessfulAt, 100);
  assert.equal(failed.diagnostic.stage, 'authentication');
  assert.equal(failed.diagnostic.code, 'auth');
  assert.equal(failed.diagnostic.lastSuccessfulAt, 100);
  assert.match(failed.diagnostic.action, /重新授权|更新凭据/);
  assert.equal(failed.results[0].diagnostic.lastSuccessfulAt, 100);
});

test('多 Server 有成功也有失败时摘要为 degraded', () => {
  const second = { ...record, key: 'demo-second', serverKey: 'second', serverName: 'demo-second' };
  const summary = buildHealthSummary({
    connectorId: 'demo',
    records: [record, second],
    results: [
      { ok: true, kind: 'connected', serverKey: 'main', serverName: 'demo' },
      { ok: false, kind: 'dns', serverKey: 'second', serverName: 'demo-second', message: '域名解析失败' },
    ],
    checkedAt: 300,
  });
  assert.equal(summary.connectionState, 'degraded');
  assert.equal(summary.availableServers, 1);
  assert.equal(summary.failedServers, 1);
  assert.equal(summary.lastSuccessfulAt, 300);
  assert.equal(summary.diagnostic.code, 'dns');
});
