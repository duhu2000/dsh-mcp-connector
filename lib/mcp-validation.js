/**
 * 连接落库前的 MCP 连通性与凭据校验。
 * 只在内存中组装鉴权头并发起 initialize；校验失败时不持久化连接或凭据。
 */
import { MCP_PROTOCOL_VERSION } from './constants.js';
import { authHeaders } from './mcp-provision.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readLimitedText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('MCP 响应过大');
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
      throw new Error('MCP 响应过大');
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

function errorChain(error) {
  const parts = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    parts.push(current.code, current.name, current.message);
    current = current.cause;
  }
  return parts.filter(Boolean).join(' ');
}

export function classifyConnectionError(error) {
  const text = errorChain(error);
  if (/AbortError|timeout|timed out|ETIMEDOUT/i.test(text)) {
    return { kind: 'timeout', message: '连接超时，请检查网络、VPN/专线或服务状态' };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) {
    return { kind: 'dns', message: '域名解析失败，请检查当前网络 DNS' };
  }
  if (/ECONNRESET|ERR_SSL|TLS|certificate|socket disconnected|connection reset/i.test(text)) {
    return { kind: 'tls', message: 'TLS/网络连接被远端重置，服务可能要求专线、VPN 或来源 IP 白名单' };
  }
  if (/ECONNREFUSED/i.test(text)) {
    return { kind: 'refused', message: '目标服务拒绝连接，请检查 MCP URL 和服务状态' };
  }
  return { kind: 'network', message: '无法连接 MCP 服务，请检查网络和 MCP URL' };
}

function failed(record, kind, message, extra = {}) {
  return {
    ok: false,
    kind,
    serverKey: record.serverKey,
    serverName: record.serverName,
    message,
    ...extra,
  };
}

export async function validateConnectionRecord(record, { timeoutMs = 15_000, fetchImpl = fetch, grants = new Map() } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    const response = await fetchImpl(record.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...authHeaders(record, grants),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'dsh-mcp-connector', version: '1.0' },
        },
      }),
      signal: controller.signal,
      redirect: 'follow',
    });

    if (response.status === 401 || response.status === 403) {
      return failed(record, 'auth', `Key/Token 无效、已过期或当前账号没有该 Server 权限（HTTP ${response.status}）`, { httpStatus: response.status });
    }
    if (response.status === 429) {
      return failed(record, 'rate-limit', '服务请求过于频繁（HTTP 429），请稍后重试', { httpStatus: response.status });
    }
    if (!response.ok) {
      const message = response.status >= 500
        ? `MCP 服务暂时异常（HTTP ${response.status}）`
        : `MCP 端点拒绝连接（HTTP ${response.status}）`;
      return failed(record, 'http', message, { httpStatus: response.status });
    }

    const text = await readLimitedText(response);
    const payload = parseMcpPayload(text, response.headers.get('content-type') ?? '');
    if (!payload || payload.jsonrpc !== '2.0') {
      return failed(record, 'protocol', '目标地址可访问，但未返回有效的 MCP 初始化响应');
    }
    if (payload.error) {
      const rawMessage = String(payload.error.message ?? '').replace(/\s+/g, ' ').slice(0, 180);
      if (/unauthori[sz]ed|forbidden|invalid.?token|invalid.?key|credential|access.?denied|未授权|无权|密钥|令牌/i.test(rawMessage)) {
        return failed(record, 'auth', `Key/Token 无效或没有权限${rawMessage ? `：${rawMessage}` : ''}`);
      }
      return failed(record, 'protocol', `MCP 初始化失败${rawMessage ? `：${rawMessage}` : ''}`);
    }
    const result = payload.result;
    if (!result || typeof result !== 'object' || !(result.protocolVersion || result.serverInfo || result.capabilities)) {
      return failed(record, 'protocol', '目标地址未完成 MCP initialize 握手');
    }
    return {
      ok: true,
      kind: 'connected',
      serverKey: record.serverKey,
      serverName: record.serverName,
      httpStatus: response.status,
      protocolVersion: result.protocolVersion ?? '',
    };
  } catch (error) {
    const classified = classifyConnectionError(error);
    return failed(record, classified.kind, classified.message);
  } finally {
    clearTimeout(timer);
  }
}

export async function validateConnectionRecords(records, options = {}) {
  const concurrency = Math.max(1, Math.min(Number(options.concurrency) || records.length || 1, records.length || 1));
  const results = new Array(records.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= records.length) return;
      results[index] = await validateConnectionRecord(records[index], options);
    }
  });
  await Promise.all(workers);
  const failures = results.filter((result) => !result.ok);
  if (failures.length === 0) {
    return { ok: true, message: `已验证 ${results.length} 个 MCP Server`, detail: { results } };
  }
  const summary = failures.slice(0, 3).map((result) => `${result.serverName || result.serverKey || 'MCP Server'}：${result.message}`).join('；');
  const more = failures.length > 3 ? `；另有 ${failures.length - 3} 个 Server 未通过` : '';
  return {
    ok: false,
    message: `连接验证失败：${summary}${more}。未保存连接，请修正后重试。`,
    detail: { results },
  };
}
