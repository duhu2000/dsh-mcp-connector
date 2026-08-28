/**
 * 存储域封装：一个 domain 三张表（connections / grants / catalog）。
 * OAuth grant 同步写入本机受限权限 journal，防止多 Host 的整文件
 * last-write-wins 覆盖新轮换 Token；凭证不进入 loader 配置树或日志。
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { connectionRecordSchema, grantRecordSchema, catalogRecordSchema } from './schema.js';
import { DEFAULT_ACCOUNT } from './constants.js';
import { shortHash } from './util.js';
import { GrantJournal } from './grant-journal.js';

export function defineConnectorDomain() {
  return defineDomain({
    name: 'mcp_connector',
    version: 1,
    tables: {
      connections: domainTable(connectionRecordSchema),
      grants: domainTable(grantRecordSchema),
      catalog: domainTable(catalogRecordSchema),
    },
  });
}

/** 连接实例表 */
export class ConnectionStore {
  constructor(domain) {
    this.table = domain.tables.get('connections');
    if (!this.table) throw new Error('mcp-connector: domain table "connections" not found');
  }

  async get(key) {
    return this.table.get(key);
  }

  async put(record) {
    const next = { ...record, updatedAt: Date.now() };
    await this.table.put(record.key, next);
    return next;
  }

  async delete(key) {
    return this.table.delete(key);
  }

  async entries() {
    const out = [];
    for (const [key, value] of this.table.entries()) out.push([key, value]);
    return out;
  }
}

/** OAuth 授权表（通用多 issuer / 多账号） */
export class GrantStore {
  constructor(domain, { journalDir, journal, logger } = {}) {
    this.table = domain.tables.get('grants');
    if (!this.table) throw new Error('mcp-connector: domain table "grants" not found');
    this.journal = journal ?? new GrantJournal({ rootDir: journalDir, logger });
  }

  keyFor(account, issuer, clientId, scope) {
    return `grant:${account}:${shortHash(`${issuer}|${clientId}|${scope}`)}`;
  }

  async get(key) {
    const legacy = await this.table.get(key);
    const journal = await this.journal.get(key);
    if (!legacy) return journal;
    if (!journal) return legacy;
    return journal.updatedAt >= legacy.updatedAt ? journal : legacy;
  }

  async put(grant) {
    const next = { ...grant, updatedAt: Date.now() };
    // Journal 先落盘：即使 DSH JSON domain 被另一进程的旧内存整文件覆盖，
    // 下次刷新仍能从独立记录取回最新的轮换 Token。
    await this.journal.put(next);
    await this.table.put(grant.key, next);
    return next;
  }

  async delete(key) {
    const [journalDeleted, tableDeleted] = await Promise.all([
      this.journal.delete(key),
      this.table.delete(key),
    ]);
    return journalDeleted || tableDeleted;
  }

  async entries() {
    const merged = new Map();
    for (const [key, value] of this.table.entries()) merged.set(key, value);
    for (const [key, value] of await this.journal.entries()) {
      const current = merged.get(key);
      if (!current || value.updatedAt >= current.updatedAt) merged.set(key, value);
    }
    return [...merged.entries()];
  }

  async withRefreshLock(key, task, options) {
    return this.journal.withLock(key, task, options);
  }
}

/** 目录缓存 / 本地覆盖表 */
export class CatalogStore {
  constructor(domain) {
    this.table = domain.tables.get('catalog');
    if (!this.table) throw new Error('mcp-connector: domain table "catalog" not found');
  }

  async getRemote() {
    return this.table.get('remote');
  }

  async putRemote({ etag, connectors }) {
    const record = { key: 'remote', updatedAt: Date.now(), etag: etag ?? undefined, connectors };
    await this.table.put('remote', record);
    return record;
  }

  async getOverrides() {
    return this.table.get('overrides');
  }

  async getDynamic() {
    return this.table.get('dynamic');
  }

  async putDynamic(connectors) {
    const record = { key: 'dynamic', updatedAt: Date.now(), connectors };
    await this.table.put('dynamic', record);
    return record;
  }

  async putOverrides(connectors) {
    const record = { key: 'overrides', updatedAt: Date.now(), connectors };
    await this.table.put('overrides', record);
    return record;
  }
}

export { DEFAULT_ACCOUNT };
