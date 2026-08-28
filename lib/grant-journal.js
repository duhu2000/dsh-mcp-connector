/**
 * OAuth Grant 跨进程轮换日志。
 *
 * DSH JSON storage 以“每进程内存状态 + 整文件原子替换”实现，并不保证两个
 * DSH Host 同时打开同一 domain 时的写入一致性。Refresh Token 又通常每次刷新都
 * 会轮换，所以 Desktop 与 dsh web 并行时必须额外做跨进程串行化。
 *
 * 每个 Grant 独立文件，避免一个过期进程覆盖其他 Grant；文件与锁均位于
 * $DSH_HOME/storages/mcp_connector_grants_v1，目录 0700、文件 0600。
 */
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { grantRecordSchema } from './schema.js';

const JOURNAL_VERSION = 1;
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_LOCK_MS = 5 * 60_000;

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function fileId(grantKey) {
  return createHash('sha256').update(grantKey).digest('hex');
}

export function defaultGrantJournalDir() {
  if (process.env.NODE_TEST_CONTEXT) return null;
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return resolve(dshHome, 'storages', 'mcp_connector_grants_v1');
}

async function writeAtomic(path, document) {
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

function parseDocument(text, path) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(`OAuth grant journal is malformed: ${path}`, { cause: error });
  }
  if (document?.version !== JOURNAL_VERSION) {
    throw new Error(`OAuth grant journal version is unsupported: ${path}`);
  }
  const parsed = grantRecordSchema.safeParse(document.grant);
  if (!parsed.success) {
    throw new Error(`OAuth grant journal record is invalid: ${path}`);
  }
  return parsed.data;
}

export class GrantJournal {
  constructor({ rootDir = defaultGrantJournalDir(), logger } = {}) {
    this.rootDir = rootDir ? resolve(rootDir) : null;
    this.logger = logger;
  }

  get enabled() {
    return this.rootDir !== null;
  }

  async ensureRoot() {
    if (!this.rootDir) return;
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    await chmod(this.rootDir, 0o700);
  }

  recordPath(grantKey) {
    return join(this.rootDir, `${fileId(grantKey)}.json`);
  }

  lockPath(grantKey) {
    return join(this.rootDir, `${fileId(grantKey)}.lock`);
  }

  async get(grantKey) {
    if (!this.rootDir) return undefined;
    try {
      return parseDocument(await readFile(this.recordPath(grantKey), 'utf8'), this.recordPath(grantKey));
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined;
      this.logger?.warn?.(`skip unreadable OAuth grant journal record ${fileId(grantKey)}: ${error.message}`);
      return undefined;
    }
  }

  async entries() {
    if (!this.rootDir) return [];
    await this.ensureRoot();
    const names = await readdir(this.rootDir).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
    const out = [];
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      const path = join(this.rootDir, name);
      try {
        const grant = parseDocument(await readFile(path, 'utf8'), path);
        out.push([grant.key, grant]);
      } catch (error) {
        this.logger?.warn?.(`skip unreadable OAuth grant journal record ${name}: ${error.message}`);
      }
    }
    return out;
  }

  async put(grant) {
    if (!this.rootDir) return grant;
    await this.ensureRoot();
    const parsed = grantRecordSchema.parse(grant);
    await writeAtomic(this.recordPath(parsed.key), { version: JOURNAL_VERSION, grant: parsed });
    return parsed;
  }

  async delete(grantKey) {
    if (!this.rootDir) return false;
    try {
      await rm(this.recordPath(grantKey));
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async withLock(grantKey, task, {
    timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    staleLockMs = DEFAULT_STALE_LOCK_MS,
  } = {}) {
    if (!this.rootDir) return task();
    await this.ensureRoot();
    const path = this.lockPath(grantKey);
    const startedAt = Date.now();
    const owner = randomUUID();
    let handle;
    for (;;) {
      try {
        handle = await open(path, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify({ owner, pid: process.pid, createdAt: Date.now() }), 'utf8');
          await handle.sync();
        } catch (error) {
          await handle.close().catch(() => {});
          await rm(path, { force: true }).catch(() => {});
          throw error;
        }
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const lockStat = await stat(path).catch(() => null);
        if (lockStat && Date.now() - lockStat.mtimeMs > staleLockMs) {
          await rm(path, { force: true });
          continue;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          const timeout = new Error('timed out waiting for another DSH process to finish OAuth refresh');
          timeout.code = 'refresh_lock_timeout';
          throw timeout;
        }
        await sleep(100);
      }
    }
    try {
      return await task();
    } finally {
      await handle?.close().catch(() => {});
      // 避免极端超时下旧持有者删掉已被新进程接管的锁（ABA）。
      const current = await readFile(path, 'utf8').catch(() => '');
      if (current.includes(`"owner":"${owner}"`)) {
        await rm(path, { force: true }).catch(() => {});
      }
    }
  }
}
