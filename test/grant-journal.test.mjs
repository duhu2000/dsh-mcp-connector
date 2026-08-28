import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantJournal } from '../lib/grant-journal.js';
import { GrantStore } from '../lib/stores.js';

function makeTable(initial = []) {
  const records = new Map(initial);
  return {
    get: (key) => records.get(key),
    async put(key, value) { records.set(key, value); },
    async delete(key) { return records.delete(key); },
    entries: () => [...records.entries()][Symbol.iterator](),
  };
}

function makeDomain(grants) {
  return { tables: new Map([['grants', grants]]) };
}

function grant(overrides = {}) {
  return {
    key: 'grant:default:journal-test',
    issuer: 'https://oauth.example.com',
    clientId: 'client-id',
    tokenEndpointAuthMethod: 'none',
    scope: 'mcp:tools',
    account: 'default',
    accessToken: 'access-old',
    accessTokenExpiresAt: Date.now() - 1_000,
    refreshToken: 'refresh-old',
    authorizedResources: ['https://mcp.example.com/stream'],
    connectorIds: ['example'],
    updatedAt: Date.now() - 10_000,
    ...overrides,
  };
}

test('Grant journal 以 0700/0600 独立原子保存最新轮换 Token', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-grant-journal-'));
  try {
    const journal = new GrantJournal({ rootDir: root });
    const next = grant({ refreshToken: 'refresh-new', accessToken: 'access-new', updatedAt: Date.now() });
    await journal.put(next);
    assert.deepEqual(await journal.get(next.key), next);
    if (process.platform !== 'win32') {
      assert.equal((await stat(root)).mode & 0o777, 0o700);
      assert.equal((await stat(journal.recordPath(next.key))).mode & 0o777, 0o600);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('两个进程内存表不一致时，GrantStore 仍以 journal 新 Token 为准', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-grant-store-'));
  try {
    const old = grant();
    const firstTable = makeTable([[old.key, old]]);
    const secondTable = makeTable([[old.key, old]]);
    const first = new GrantStore(makeDomain(firstTable), { journalDir: root });
    const second = new GrantStore(makeDomain(secondTable), { journalDir: root });

    const persisted = await first.put({
      ...old,
      accessToken: 'access-rotated',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      refreshToken: 'refresh-rotated',
    });
    const fromStaleProcess = await second.get(old.key);

    assert.equal(fromStaleProcess.refreshToken, 'refresh-rotated');
    assert.equal(fromStaleProcess.accessToken, 'access-rotated');
    assert.equal(fromStaleProcess.updatedAt, persisted.updatedAt);
    assert.equal(secondTable.get(old.key).refreshToken, 'refresh-old', '模拟另一 Host 仍持有旧内存快照');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Grant journal 锁会串行两个 Host 的 Token 轮换', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-grant-lock-'));
  try {
    const journalA = new GrantJournal({ rootDir: root });
    const journalB = new GrantJournal({ rootDir: root });
    const events = [];
    const first = journalA.withLock('grant:lock', async () => {
      events.push('a:start');
      await new Promise((done) => setTimeout(done, 120));
      events.push('a:end');
    });
    await new Promise((done) => setTimeout(done, 20));
    const second = journalB.withLock('grant:lock', async () => {
      events.push('b:start');
      events.push('b:end');
    });
    await Promise.all([first, second]);
    assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
