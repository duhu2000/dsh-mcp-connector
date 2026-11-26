/**
 * 平台工具：打开系统默认浏览器（macOS/Linux/Windows）+ 通用小工具。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { DEFAULT_LOCALE, createTranslator } from './i18n/index.js';

/** 缺省译文：中文（未传入 t 的调用点保持原样）。 */
const tZh = createTranslator(DEFAULT_LOCALE);

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

/**
 * 归一化用户可编辑的连接显示名；不用于 serverName / 工具前缀。
 *
 * @param {unknown} input 用户输入
 * @param {{t?: (msgid: string) => string}} [options] `t` 缺省为中文译文
 * @returns {string} 归一化后的名称
 */
export function normalizeConnectionDisplayName(input, { t = createTranslator(DEFAULT_LOCALE) } = {}) {
  const name = String(input ?? '').trim();
  if (!name) throw new Error(t('连接显示名不能为空'));
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error(t('连接显示名不能包含控制字符'));
  if ([...name].length > 80) throw new Error(t('连接显示名不能超过 80 个字符'));
  return name;
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
  // 小写 + 去首尾空白 + 去 IPv6 方括号；不解析域名（DNS rebinding 防护），只做字面量归一。
  return String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

/**
 * 把一个 IPv4-mapped IPv6（::ffff:a.b.c.d）还原成 IPv4 字面量，供后续按 IPv4 分类。
 * 形如 0:0:0:0:0:ffff:a.b.c.d 的完整写法会被 new URL() 归一成 ::ffff:a.b.c.d，这里统一再展开。
 * 返回 null 表示不是 IPv4-mapped 形式。
 */
function mappedV4ToV4(host) {
  if (!host.startsWith('::ffff:')) return null;
  const tail = host.slice('::ffff:'.length);
  const dotted = tail.split('.');
  if (dotted.length === 4) {
    // 允许点分十进制或十六进制八位组，如 ::ffff:127.0.0.1 / ::ffff:7f00:1（后者无点分，走 hextets 分支）
    const octets = dotted.map((s) => Number.parseInt(s, 16));
    if (octets.every((o) => Number.isFinite(o) && o >= 0 && o <= 255)) return octets.join('.');
  }
  const hextets = tail.split(':');
  if (hextets.length === 2) {
    const hi = Number.parseInt(hextets[0], 16);
    const lo = Number.parseInt(hextets[1], 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    }
  }
  return null;
}

/** 仅接受字面量 RFC1918 IPv4 / RFC4193 IPv6 ULA / IPv4-mapped 私网，不解析域名。 */
export function isPrivateNetworkHost(hostname) {
  const host = normalizedHostname(hostname);
  const mapped = mappedV4ToV4(host);
  if (mapped) return isPrivateNetworkHost(mapped);
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
  const host = normalizedHostname(hostname);
  const mapped = mappedV4ToV4(host);
  if (mapped) return isLoopbackHost(mapped);
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
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

/**
 * 同源重定向守卫：为带凭据的请求提供统一的 `redirect` 策略与跳转校验。
 *
 * 背景：Node 的 fetch（undici）在**跨源**重定向时只剥离 `authorization` 与 `cookie`，
 * 其余自定义鉴权头（如 `x-api-key`、目录卡片声明的头）与 `Mcp-Session-Id` 会被继续发送到
 * 跳转目标，构成凭据外泄通道。因此凡是携带鉴权头的请求都必须显式处理跳转。
 *
 * 约定：
 *   - `CREDENTIALED_REDIRECT`：携带凭据的请求用 `'manual'`，由调用方逐跳校验；
 *   - `resolveCredentialedRedirect(response, currentUrl)`：判断一次 3xx 是否允许跟进，
 *     跨源一律拒绝，同源最多跟进 `maxHops` 次，避免无限循环。
 */
export const CREDENTIALED_REDIRECT = 'manual';

/** 判断两个 URL 是否严格同源（协议 + 主机名 + 端口，忽略路径与查询）。 */
export function isSameOrigin(a, b) {
  const left = parseUrl(a);
  const right = parseUrl(b);
  return left.origin === right.origin;
}

/**
 * 校验一次带凭据的重定向是否可以安全跟进。
 *
 * @param {Response} response 上一次请求的响应
 * @param {string} currentUrl 该请求使用的 URL
 * @param {{ maxHops?: number, hops?: number, allowInsecurePrivateNetwork?: boolean, t?: (msgid: string, params?: object) => string }} [options]
 * @returns {{ follow: false } | { follow: true, url: string }} 允许跟进时返回绝对目标 URL
 */
export function resolveCredentialedRedirect(response, currentUrl, { maxHops = 1, hops = 0, allowInsecurePrivateNetwork = false, t: translate } = {}) {
  const t = typeof translate === 'function' ? translate : tZh;
  const status = Number(response?.status ?? 0);
  if (![301, 302, 303, 307, 308].includes(status)) return { follow: false };
  const location = response?.headers?.get?.('location');
  if (!location) throw new Error(t('重定向响应缺少 Location'));
  if (hops >= maxHops) throw new Error(t('重定向次数超出上限'));
  let target;
  try {
    target = new URL(location, currentUrl).toString();
  } catch {
    throw new Error(t('重定向目标不是合法 URL'));
  }
  // 跨源跳转会把仍挂在请求上的自定义鉴权头带到第三方：拒绝而不是降级。
  if (!isSameOrigin(currentUrl, target)) throw new Error(t('拒绝跨源重定向'));
  // 目标必须仍是 https / 回环 http；用户显式批准过的私网 HTTP 连接允许同源跳转继续走 http。
  assertConnectionUrl(target, { allowInsecurePrivateNetwork });
  return { follow: true, url: target };
}

/**
 * 云厂商元数据端点 + 各类内网/链路本地地址：任何"用户提供的 URL 由本机去请求"的入口都必须拒绝。
 */
const BLOCKED_INSTALL_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', 'fd00:ec2::254']);

/** 链路本地 IPv4 169.254.0.0/16（含云元数据 169.254.169.254）与 100.64.0.0/10（CGNAT）等保留段。 */
function isNonPublicV4(octets) {
  // 169.254.0.0/16 链路本地
  if (octets[0] === 169 && octets[1] === 254) return true;
  // 100.64.0.0/10 运营商级 NAT（RFC 6598）
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  // 198.18.0.0/15 基准测试（RFC 2544）
  if (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) return true;
  // 192.0.0.0/24、240.0.0.0/4（保留/未分配）等更保守地拒绝
  if (octets[0] === 192 && octets[1] === 0 && octets[2] === 0) return true;
  if (octets[0] >= 224) return true; // 组播/保留 224.0.0.0/3 起
  return false;
}

/**
 * 远端定义安装入口（`installFromUrl`）专用：只允许公网 https。
 *
 * 与 `assertSafeUrl` 的差别：那个函数服务的是"用户自己填的连接端点"，需要放行回环 http；
 * 而这里拉取的是**别人提供的 JSON**，会让本机立刻联网并按内容建连，因此必须排除回环、
 * 私网与链路本地地址，避免把插件变成内网/元数据探测跳板。
 */
export function assertPublicInstallUrl(rawUrl) {
  const parsed = parseUrl(rawUrl);
  if (parsed.protocol !== 'https:') {
    const failure = new Error(`remote definition must use https: ${rawUrl}`);
    failure.code = 'INSTALL_URL_HOST_NOT_ALLOWED';
    throw failure;
  }
  const url = assertSafeUrl(rawUrl);
  const host = normalizedHostname(url.hostname);
  const error = (reason) => {
    const failure = new Error(`remote definition host is not allowed (${reason}): ${rawUrl}`);
    failure.code = 'INSTALL_URL_HOST_NOT_ALLOWED';
    return failure;
  };
  // IPv6 字面量：先还原 IPv4-mapped，再按 IPv4 分类；否则回环 / ULA / 链路本地统统拒绝。
  const mapped = mappedV4ToV4(host);
  if (mapped) {
    const octets = mapped.split('.').map(Number);
    if (isLoopbackHost(mapped)) throw error('loopback');
    if (isPrivateNetworkHost(mapped)) throw error('private network');
    if (isNonPublicV4(octets)) throw error('non-public ipv4');
    return url;
  }
  if (host.includes(':')) {
    const bare = host.replace(/^\[|\]$/g, '');
    if (bare === '::1' || bare === '::' || /^f[cd][0-9a-f]{2}:/i.test(bare) || /^fe[89ab][0-9a-f]:/i.test(bare)) {
      throw error('ipv6 private or loopback');
    }
    // 其余 IPv6（含 64:ff9b:: 的 NAT64 前缀、2002:: 的 6to4 前缀）无法可靠判公网，一律拒绝。
    throw error('ipv6 literal not allowed');
  }
  if (BLOCKED_INSTALL_HOSTS.has(host)) throw error('metadata endpoint');
  // 尾点 FQDN 需归一：new URL 会保留尾点，但 DNS 会忽略，这里显式去尾点后判定。
  const bareHost = host.replace(/\.$/, '');
  if (bareHost === 'localhost' || bareHost.endsWith('.localhost')) throw error('loopback');
  if (isPrivateNetworkHost(bareHost)) throw error('private network');
  const octets = bareHost.split('.');
  if (octets.length === 4 && octets.every((o) => /^\d+$/.test(o))) {
    const nums = octets.map(Number);
    if (nums.every((o) => Number.isFinite(o) && o >= 0 && o <= 255)) {
      if (nums[0] === 127 || nums[0] === 0) throw error('loopback');
      if (isNonPublicV4(nums)) throw error('non-public ipv4');
      if (isPrivateNetworkHost(bareHost)) throw error('private network');
    }
  }
  return url;
}

/**
 * 目录卡片 / URL 安装声明的 HTTP 服务器端点专用校验：与 assertPublicInstallUrl 相同的内网阻断，
 * 但保留回环 http（本地市场卡片测试、用户显式回环连接依赖它）。用于 auditDescriptor 对 servers[].url 把关，
 * 防止远端卡片把插件变成向内网 / 元数据发请求的跳板。
 */
export function assertPublicServerUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  const host = normalizedHostname(url.hostname);
  const error = (reason) => {
    const failure = new Error('connector server endpoint host is not allowed (' + reason + '): ' + rawUrl);
    failure.code = 'SERVER_URL_HOST_NOT_ALLOWED';
    return failure;
  };
  // 回环（http/https 均可）与用户显式批准的内网 http 由调用方按连接语义处理，这里只拦「远端声明」的内网目标。
  const mapped = mappedV4ToV4(host);
  if (mapped) {
    if (isLoopbackHost(mapped)) return url; // 回环放行（等同 localhost）
    const octets = mapped.split('.').map(Number);
    if (isPrivateNetworkHost(mapped) || isNonPublicV4(octets)) throw error('non-public ipv4');
    return url;
  }
  if (host.includes(':')) {
    const bare = host.replace(/^\[|\]$/g, '');
    if (bare === '::1' || bare === '::') return url; // 回环放行
    if (/^f[cd][0-9a-f]{2}:/i.test(bare) || /^fe[89ab][0-9a-f]:/i.test(bare)) throw error('ipv6 private or loopback');
    throw error('ipv6 literal not allowed');
  }
  const bareHost = host.replace(/\.$/, '');
  if (bareHost === 'localhost' || bareHost.endsWith('.localhost')) return url; // 回环放行
  if (isPrivateNetworkHost(bareHost)) throw error('private network');
  const octets = bareHost.split('.');
  if (octets.length === 4 && octets.every((o) => /^\d+$/.test(o))) {
    const nums = octets.map(Number);
    if (nums.every((o) => Number.isFinite(o) && o >= 0 && o <= 255)) {
      if (nums[0] === 127 || nums[0] === 0) return url; // 回环放行
      if (isPrivateNetworkHost(bareHost) || isNonPublicV4(nums)) throw error('non-public ipv4');
    }
  }
  return url;
}

/** header 名白名单 */
export function assertSafeHeaderName(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(name))) {
    throw new Error(`invalid header name: ${name}`);
  }
  return String(name);
}
