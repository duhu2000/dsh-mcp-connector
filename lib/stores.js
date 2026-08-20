/**
 * 存储域封装：一个 domain 三张表（connections / grants / catalog）。
 * 落盘 ~/.dsh/storages/（0700），凭证不进入 loader 配置树以外的任何地方。
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { connectionRecordSchema, grantRecordSchema, catalogRecordSchema } from './schema.js';
import { DEFAULT_ACCOUNT } from './constants.js';
import { shortHash } from './util.js';

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
  constructor(domain) {
    this.table = domain.tables.get('grants');
    if (!this.table) throw new Error('mcp-connector: domain table "grants" not found');
  }

  keyFor(account, issuer, clientId, scope) {
    return `grant:${account}:${shortHash(`${issuer}|${clientId}|${scope}`)}`;
  }

  async get(key) {
    return this.table.get(key);
  }

  async put(grant) {
    const next = { ...grant, updatedAt: Date.now() };
    await this.table.put(grant.key, next);
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
