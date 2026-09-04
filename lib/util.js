/**
 * 平台工具：打开系统默认浏览器（macOS/Linux/Windows）+ 通用小工具。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * 按平台构建打开命令（纯函数，便于单测）。
 */
export function buildOpenCommand(url, platform = process.platform) {
  if (platform === 'darwin') {
    return { command: 'open', args: [url], options: { detached: true, stdio: 'ignore' } };
  }
  if (platform === 'win32') {
    // Windows 关键修复：cmd.exe 会把未加引号的 `&` 当作命令分隔符，导致授权 URL
    // 查询参数丢失。必须用双引号包裹 URL、`start` 空标题占位、verbatimArguments 原样传参。
    return {
      command: 'cmd',
      args: ['/c', 'start', '""', `"${url}"`],
      options: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true },
    };
  }
  return { command: 'xdg-open', args: [url], options: { detached: true, stdio: 'ignore' } };
}

export function openBrowser(url, logger) {
  const { command, args, options } = buildOpenCommand(url);
  const child = spawn(command, args, options);
  child.on('error', (error) => {
    logger?.warn(`mcp-connector: failed to open browser via '${command}': ${error.message}`);
  });
  child.unref();
}

/** 稳定短哈希（用于 grant key 等） */
export function shortHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** 归一化 serverName：小写、空格转连字符、去除非法字符 */
export function slugServerName(input) {
  const slug = String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .slice(0, 63);
  // 中文等非 ASCII 名称归一后可能为空：回退到稳定 ASCII 名，保证可连接
  if (!slug) return `srv-${shortHash(input)}`;
  return slug;
}

function parseUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`invalid url: ${rawUrl}`);
  }
  return url;
}

function normalizedHostname(hostname) {
  return String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

/** 只接受字面量 RFC1918 IPv4 或 RFC4193 IPv6 ULA，不解析域名，避免 DNS rebinding。 */
export function isPrivateNetworkHost(hostname) {
  const host = normalizedHostname(hostname);
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split('.').map(Number);
    return octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }
  if (version === 6) {
    const firstHextet = Number.parseInt(host.split(':', 1)[0], 16);
    return Number.isFinite(firstHextet) && (firstHextet & 0xfe00) === 0xfc00;
  }
  return false;
}

function isLoopbackHost(hostname) {
  return ['127.0.0.1', 'localhost', '::1'].includes(normalizedHostname(hostname));
}

/** URL 协议白名单：仅 https / 回环 http。用于目录、OAuth 和其他公共边界。 */
export function assertSafeUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url;
  throw new Error(`url protocol not allowed (only https or loopback http): ${rawUrl}`);
}

/**
 * 用户自建 MCP 连接的窄范围例外：默认仍拒绝局域网 HTTP，只在用户显式确认且
 * host 为私有 IP 字面量时放行。公网 HTTP、域名、链路本地和元数据地址仍拒绝。
 */
export function assertConnectionUrl(rawUrl, { allowInsecurePrivateNetwork = false } = {}) {
  const url = parseUrl(rawUrl);
  if (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname))) return url;
  if (url.protocol === 'http:' && isPrivateNetworkHost(url.hostname)) {
    if (allowInsecurePrivateNetwork === true) return url;
    const error = new Error(`insecure private-network HTTP requires explicit confirmation: ${rawUrl}`);
    error.code = 'INSECURE_PRIVATE_NETWORK_REQUIRES_CONFIRMATION';
    throw error;
  }
  throw new Error(`url protocol not allowed (only https, loopback http, or explicitly approved private-network http): ${rawUrl}`);
}

/** header 名白名单 */
export function assertSafeHeaderName(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(name))) {
    throw new Error(`invalid header name: ${name}`);
  }
  return String(name);
}
