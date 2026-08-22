/**
 * Streamable HTTP MCP 会话客户端。
 *
 * 详情页不能直接向有状态的 MCP Server 发送 tools/list：必须先
 * initialize，保留响应的 Mcp-Session-Id，发送 notifications/initialized，
 * 再在后续每个请求中携带会话头和凭据。
 */
import { MCP_PROTOCOL_VERSION } from './constants.js';
import { authHeaders } from './mcp-provision.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_PAGES = 100;
const MAX_TOOLS = 10_000;

export class McpHttpError extends Error {
  constructor(message, { kind = 'protocol', status } = {}) {
    super(message);
    this.name = 'McpHttpError';
    this.kind = kind;
    this.status = status;
  }
}

async function readLimitedText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new McpHttpError('MCP 响应过大');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new McpHttpError('MCP 响应过大');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseMcpPayload(text, contentType = '') {
  if (contentType.includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try { return JSON.parse(line.slice(5).trim()); } catch {}
    }
    return undefined;
  }
  try { return JSON.parse(text); } catch { return undefined; }
}

function responseError(response, payload, text) {
  const rawMessage = String(payload?.error?.message ?? text ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (response.status === 401 || response.status === 403) {
    return new McpHttpError(`凭据无效、已过期或权限不足（HTTP ${response.status}）`, { kind: 'auth', status: response.status });
  }
  if (response.status === 429) {
    return new McpHttpError('服务请求过于频繁（HTTP 429），请稍后重试', { kind: 'rate-limit', status: response.status });
  }
  const suffix = rawMessage ? `：${rawMessage}` : '';
  return new McpHttpError(`MCP 请求失败（HTTP ${response.status}）${suffix}`, { kind: 'http', status: response.status });
}

function payloadError(payload) {
  if (!payload?.error) return null;
  const rawMessage = String(payload.error.message ?? '').replace(/\s+/g, ' ').slice(0, 180);
  const kind = /unauthori[sz]ed|forbidden|invalid.?token|invalid.?key|credential|access.?denied|未授权|无权|密钥|令牌/i.test(rawMessage)
    ? 'auth'
    : 'protocol';
  return new McpHttpError(`MCP 返回错误${rawMessage ? `：${rawMessage}` : ''}`, { kind });
}

function requestHeaders(record, grants, { sessionId, protocolVersion } = {}) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...authHeaders(record, grants),
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
  };
}

async function post(record, payload, { grants, sessionId, protocolVersion, signal, fetchImpl }) {
  const response = await fetchImpl(record.url, {
    method: 'POST',
    headers: requestHeaders(record, grants, { sessionId, protocolVersion }),
    body: JSON.stringify(payload),
    signal,
    redirect: 'follow',
  });
  const text = await readLimitedText(response);
  const parsed = parseMcpPayload(text, response.headers.get('content-type') ?? '');
  return { response, text, payload: parsed };
}

async function closeSession(record, { grants, sessionId, protocolVersion, fetchImpl }) {
  if (!sessionId) return;
  try {
    const response = await fetchImpl(record.url, {
      method: 'DELETE',
      headers: requestHeaders(record, grants, { sessionId, protocolVersion }),
      redirect: 'follow',
      signal: AbortSignal.timeout(3_000),
    });
    await response.body?.cancel().catch(() => {});
  } catch {}
}

export async function listMcpTools(record, {
  timeoutMs = 15_000,
  fetchImpl = fetch,
  grants = new Map(),
} = {}) {
  if (record.transport && record.transport !== 'streamable-http') {
    throw new McpHttpError(`动态工具加载暂不支持 ${record.transport} 传输`, { kind: 'protocol' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  let sessionId = '';
  let protocolVersion = MCP_PROTOCOL_VERSION;
  try {
    const initialized = await post(record, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'dsh-mcp-connector', version: '1.0' },
      },
    }, { grants, signal: controller.signal, fetchImpl });
    if (!initialized.response.ok) throw responseError(initialized.response, initialized.payload, initialized.text);
    const initPayloadError = payloadError(initialized.payload);
    if (initPayloadError) throw initPayloadError;
    if (!initialized.payload?.result || typeof initialized.payload.result !== 'object') {
      throw new McpHttpError('MCP Server 未返回有效的 initialize 结果');
    }
    protocolVersion = initialized.payload.result.protocolVersion || MCP_PROTOCOL_VERSION;
    sessionId = initialized.response.headers.get('mcp-session-id') ?? '';

    const notification = await post(record, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }, { grants, sessionId, protocolVersion, signal: controller.signal, fetchImpl });
    if (!notification.response.ok) {
      throw responseError(notification.response, notification.payload, notification.text);
    }

    const tools = [];
    const seenCursors = new Set();
    let cursor;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const listed = await post(record, {
        jsonrpc: '2.0',
        id: page + 2,
        method: 'tools/list',
        params: cursor ? { cursor } : {},
      }, { grants, sessionId, protocolVersion, signal: controller.signal, fetchImpl });
      if (!listed.response.ok) throw responseError(listed.response, listed.payload, listed.text);
      const listPayloadError = payloadError(listed.payload);
      if (listPayloadError) throw listPayloadError;
      const pageTools = listed.payload?.result?.tools;
      if (!Array.isArray(pageTools)) throw new McpHttpError('MCP tools/list 未返回工具数组');
      tools.push(...pageTools);
      if (tools.length > MAX_TOOLS) {
        throw new McpHttpError(`MCP 工具数量超过安全上限（${MAX_TOOLS}）`);
      }

      const nextCursor = listed.payload?.result?.nextCursor;
      if (typeof nextCursor !== 'string' || nextCursor.length === 0) {
        return { tools, protocolVersion, sessionful: Boolean(sessionId), pages: page + 1 };
      }
      if (seenCursors.has(nextCursor)) {
        throw new McpHttpError('MCP tools/list 返回了重复分页游标');
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new McpHttpError(`MCP tools/list 分页超过安全上限（${MAX_TOOL_PAGES} 页）`);
  } finally {
    clearTimeout(timer);
    await closeSession(record, { grants, sessionId, protocolVersion, fetchImpl });
  }
}
