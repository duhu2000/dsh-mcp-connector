/** Local-only overlay for credential-free catalog stdio entries. */
import { z } from 'zod';
import { CUSTOM_CONNECTOR_ID, JSON_CONNECTOR_ID } from './constants.js';
// Do not import connection-editor: it depends on schema via the JSON parser.
const KEEP_EXISTING_VALUE = '<KEEP_EXISTING>';
const forbiddenEnv = new Set(['__proto__', 'constructor', 'prototype', 'ELECTRON_RUN_AS_NODE']);

export const localOverridesSchema = z.object({
  argsAppend: z.array(z.string().max(8192)).max(128).optional(),
  env: z.custom((value) => value && typeof value === 'object' && !Array.isArray(value)
    && !Object.keys(value).some((key) => forbiddenEnv.has(key)))
    .pipe(z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(8192))).optional(),
  cwd: z.string().max(8192).optional(),
}).strict();

export function supportsLocalOverrides(record) {
  return record?.transport === 'stdio' && ![CUSTOM_CONNECTOR_ID, JSON_CONNECTOR_ID, 'dingtalk'].includes(record.connectorId)
    && Boolean(record.connectorId) && !record.auth && !record.oauthTokenEnv;
}

export function editableLocalOverrides(record) {
  if (!supportsLocalOverrides(record)) throw new Error('当前仅支持无凭据的市场 stdio 连接；OAuth/凭据型/CLI 桥接连接不可覆盖');
  const values = record.localOverrides ?? {};
  return JSON.stringify({
    argsAppend: values.argsAppend?.length ? [KEEP_EXISTING_VALUE] : [],
    env: Object.fromEntries(Object.keys(values.env ?? {}).map((key) => [key, KEEP_EXISTING_VALUE])),
    cwd: values.cwd ? KEEP_EXISTING_VALUE : '',
  }, null, 2);
}

export function normalizeLocalOverrides(record, input) {
  if (!supportsLocalOverrides(record)) throw new Error('当前连接不支持本地参数覆盖');
  let raw;
  try { raw = typeof input === 'string' ? JSON.parse(input) : input; }
  catch { throw new Error('本地参数必须是合法 JSON'); }
  const parsed = localOverridesSchema.safeParse(raw);
  if (!parsed.success) throw new Error('本地参数仅允许 argsAppend 字符串数组、env 字符串对象及 cwd 字符串');
  const value = parsed.data;
  const previous = record.localOverrides ?? {};
  if (value.argsAppend?.length === 1 && value.argsAppend[0] === KEEP_EXISTING_VALUE) value.argsAppend = [...(previous.argsAppend ?? [])];
  if (value.cwd === KEEP_EXISTING_VALUE) value.cwd = previous.cwd ?? '';
  for (const [key, entry] of Object.entries(value.env ?? {})) {
    if (['__proto__', 'constructor', 'prototype', 'ELECTRON_RUN_AS_NODE'].includes(key)) throw new Error('包含不允许覆盖的环境变量名');
    if (entry === KEEP_EXISTING_VALUE) {
      if (!Object.hasOwn(previous.env ?? {}, key)) throw new Error('环境变量不存在可保留的原值');
      value.env[key] = previous.env[key];
    }
  }
  if (value.argsAppend?.includes(KEEP_EXISTING_VALUE)) throw new Error('argsAppend 保留标记必须单独使用');
  if ([...(value.argsAppend ?? []), ...Object.values(value.env ?? {}), value.cwd ?? ''].some((entry) => entry.includes('\0'))) throw new Error('本地参数不可包含空字符');
  return value;
}

export function effectiveLocalRecord(record) {
  if (!record.localOverrides) return record;
  const overlay = normalizeLocalOverrides(record, record.localOverrides);
  return {
    ...record,
    args: [...(record.args ?? []), ...(overlay.argsAppend ?? [])],
    env: { ...(record.env ?? {}), ...(overlay.env ?? {}) },
    cwd: overlay.cwd || record.cwd,
  };
}
