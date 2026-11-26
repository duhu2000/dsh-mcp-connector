/**
 * 平台工具：打开系统默认浏览器（macOS/Linux/Windows）+ 通用小工具。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { DEFAULT_LOCALE, createTranslator } from './i18n/index.js';

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
  // 小写 + 去首尾空白 + 去 IPv6 方括号 + 去 FQDN 尾点；不解析域名（DNS rebinding 防护），只做字面量归一。
  // 尾点必须归一：`localhost.` / `127.0.0.1.` 与不带点的写法在 DNS 上等价，保留就会被当成新主机名绕过判定。
  return String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
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
    // 点分写法一律按十进制解析（如 ::ffff:127.0.0.1）；十六进制十六位组走下面的 hextets 分支。
    const octets = dotted.map((s) => (/^[0-9]+$/.test(s) ? Number.parseInt(s, 10) : Number.NaN));
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

/**
 * 把 IPv6 字面量展开成 8 个 16 位 hextet。支持 `::` 压缩与末尾内嵌的点分 IPv4
 * （如 `::ffff:127.0.0.1`、`64:ff9b::192.0.2.1`）。非法字面量返回 null。
 */
function expandIpv6(address) {
  let text = String(address ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!text.includes(':')) return null;
  // 末尾内嵌的点分 IPv4 先折算成两个 hextet，再按纯十六进制展开。
  const v4Tail = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail) {
    const octets = v4Tail[2].split('.').map(Number);
    if (!octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255)) return null;
    text = `${v4Tail[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const compressed = halves.length === 2;
  const missing = 8 - head.length - tail.length;
  // `::` 至少要省略一个 hextet；没有 `::` 时必须正好 8 段。
  if (compressed ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...(compressed ? Array(missing).fill('0') : []), ...tail];
  const hextets = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN));
  return hextets.every((value) => Number.isFinite(value)) ? hextets : null;
}

/** RFC 6052 NAT64（64:ff9b::/96）按内嵌位置还原成 IPv4；不是该前缀的 /96 形式返回 null。 */
function nat64ToV4(hextets) {
  if (!hextets) return null;
  if (hextets[0] !== 0x0064 || hextets[1] !== 0xff9b) return null;
  if (hextets[2] || hextets[3] || hextets[4] || hextets[5]) return null;
  return `${hextets[6] >> 8}.${hextets[6] & 0xff}.${hextets[7] >> 8}.${hextets[7] & 0xff}`;
}

/** 6to4（2002::/16）按 RFC 3056 取出内嵌 IPv4；不是该前缀返回 null。 */
function sixToFourToV4(hextets) {
  if (!hextets) return null;
  if (hextets[0] !== 0x2002) return null;
  return `${hextets[1] >> 8}.${hextets[1] & 0xff}.${hextets[2] >> 8}.${hextets[2] & 0xff}`;
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
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

/**
 * 「本机」主机名的严格判定：只认 127.0.0.1 / ::1 / localhost / *.localhost。
 *
 * 与 isLoopbackHost 的区别：那个函数服务用户自填的连接端点（保留原来的窄口径，不扩大也不收窄）；
 * 这里服务「远端声明的 URL」（卡片端点、安装入口），标准必须与 classifyPublicV4 对齐——
 * 127/8 与 0/8 整段都是本机地址，只有 127.0.0.1 才算回环放行。
 */
function isLoopbackLikeHost(hostname) {
  const host = normalizedHostname(hostname);
  return isLoopbackHost(host) || host.endsWith('.localhost');
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
 * 云厂商元数据端点 + 各类内网/链路本地地址：任何"用户提供的 URL 由本机去请求"的入口都必须拒绝。
 *
 * 远端安装入口（assertPublicInstallUrl）与远端卡片端点（assertPublicServerUrl）共用同一名单：
 * 此前只有安装入口拦 metadata.google.internal，卡片侧可以绕过去（标准漂移），这里统一。
 */
const BLOCKED_METADATA_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', 'fd00:ec2::254']);

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
 * 统一的 IPv4 公网判定：回环（127/8 与 0/8 整段）、私网、链路本地、保留段一律视为「不可用」。
 *
 * 回环与 0/8 必须按**整段**判断（127.0.0.2、0.1.2.3 同样是本机地址），
 * 只认 127.0.0.1 会漏掉 IPv4-mapped 写法。所有判定路径都必须走这里，避免分支间标准漂移。
 *
 * @param {string} address 点分 IPv4 字面量
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function classifyPublicV4(address) {
  const octets = String(address).split('.').map(Number);
  if (octets.length !== 4 || !octets.every((o) => Number.isFinite(o) && o >= 0 && o <= 255)) {
    return { ok: false, reason: 'invalid ipv4' };
  }
  if (octets[0] === 127) return { ok: false, reason: 'loopback' };
  if (octets[0] === 0) return { ok: false, reason: 'unspecified' };
  if (isPrivateNetworkHost(address)) return { ok: false, reason: 'private network' };
  if (isNonPublicV4(octets)) return { ok: false, reason: 'non-public ipv4' };
  return { ok: true };
}

/**
 * 统一的 IPv6 公网判定，与 classifyPublicV4 对称：
 *   - 回环 `::1`、未指定 `::`、ULA(fc00::/7)、链路本地(fe80::/10)、组播(ff00::/8) 一律拒绝；
 *   - IPv4-mapped（::ffff:a.b.c.d）：还原成 IPv4 后交给 classifyPublicV4，标准只有一处；
 *   - NAT64(64:ff9b::/96) / 6to4(2002::/16)：前缀内嵌 IPv4，还原后同样走 classifyPublicV4；
 *   - 其余 2000::/3 全局单播按公网放行；NAT64 / 6to4 的其它形态无法判定真实目标，保守拒绝。
 *
 * @param {string} address IPv6 字面量（可带方括号）
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function classifyPublicV6(address) {
  const host = normalizedHostname(address);
  const mapped = mappedV4ToV4(host);
  if (mapped) {
    const verdict = classifyPublicV4(mapped);
    return verdict.ok ? verdict : { ok: false, reason: `${verdict.reason} ${mapped}` };
  }
  const hextets = expandIpv6(host);
  if (!hextets) return { ok: false, reason: 'invalid ipv6' };
  if (!hextets.some((value) => value !== 0)) return { ok: false, reason: 'ipv6 unspecified' };
  if (hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1) return { ok: false, reason: 'ipv6 loopback' };
  if ((hextets[0] & 0xfe00) === 0xfc00) return { ok: false, reason: 'ipv6 unique-local' };
  if ((hextets[0] & 0xffc0) === 0xfe80) return { ok: false, reason: 'ipv6 link-local' };
  if ((hextets[0] & 0xff00) === 0xff00) return { ok: false, reason: 'ipv6 multicast' };
  const nat64 = nat64ToV4(hextets);
  if (nat64) {
    const verdict = classifyPublicV4(nat64);
    return verdict.ok ? verdict : { ok: false, reason: `${verdict.reason} (nat64) ${nat64}` };
  }
  if (hextets[0] === 0x0064 && hextets[1] === 0xff9b) return { ok: false, reason: 'nat64 prefix cannot be resolved' };
  const sixToFour = sixToFourToV4(hextets);
  if (sixToFour) {
    const verdict = classifyPublicV4(sixToFour);
    return verdict.ok ? verdict : { ok: false, reason: `${verdict.reason} (6to4) ${sixToFour}` };
  }
  // 只有 2000::/3 是当前分配中的全局单播；其余（如 100::/64 丢弃前缀）保守拒绝。
  if ((hextets[0] & 0xe000) !== 0x2000) return { ok: false, reason: 'ipv6 not global unicast' };
  return { ok: true };
}

/**
 * 是否为「本机 / 元数据」目标：回环地址（127.0.0.1、::1、localhost）与云元数据端点。
 * 远端声明的卡片端点与安装入口都用它做第一层拦截。
 */
function isBlockedMetadataHost(bareHost) {
  if (!bareHost) return false;
  if (BLOCKED_METADATA_HOSTS.has(bareHost)) return true;
  // IPv6 形式（[fd00:ec2::254] / fd00:ec2::254）与带方括号的字符串同样命中。
  return BLOCKED_METADATA_HOSTS.has(bareHost.replace(/^\[|\]$/g, ''));
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
  // IPv6 字面量：统一交给 classifyPublicV6 —— 公网 IPv6 放行，回环 / ULA / 链路本地 / 组播 /
  // NAT64 与 6to4 的可还原前缀按内嵌 IPv4 判定，无法判定的前缀保守拒绝。
  const mapped = mappedV4ToV4(host);
  if (mapped) {
    // 与公网 IPv4 分支复用同一判定，避免标准漂移（127/8 与 0/8 整段拦截）。
    const verdict = classifyPublicV4(mapped);
    if (!verdict.ok) throw error(verdict.reason + ' ' + mapped);
    return url;
  }
  if (host.includes(':')) {
    const verdict = classifyPublicV6(host);
    if (!verdict.ok) throw error(verdict.reason + ' ' + host);
    return url;
  }
  if (isBlockedMetadataHost(host)) throw error('metadata endpoint');
  // host 已在 normalizedHostname 去掉尾点并小写，`localhost.` / `127.0.0.1.` 归一后即 `localhost` / `127.0.0.1`。
  if (isLoopbackLikeHost(host)) throw error('loopback');
  if (isPrivateNetworkHost(host)) throw error('private network');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const verdict = classifyPublicV4(host);
    if (!verdict.ok) throw error(verdict.reason + ' ' + host);
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
  // 回环（http/https 均可）放行：本地市场卡片测试与用户显式回环连接依赖它；这里只拦「远端声明」的内网目标。
  // 放行范围与 assertPublicInstallUrl 的标准一致：只认 127.0.0.1 / ::1 / localhost / *.localhost。
  // 此前把 0.0.0.0 与整个 127/8 当回环放行，同段地址（127.0.0.2、0.1.2.3）因此可绕过判定 —— 标准漂移。
  if (isLoopbackLikeHost(host)) return url;
  const mapped = mappedV4ToV4(host);
  if (mapped) {
    const verdict = classifyPublicV4(mapped);
    if (!verdict.ok) throw error(verdict.reason + ' ' + mapped);
    return url;
  }
  if (host.includes(':')) {
    // 公网 IPv6 字面量放行（如 [2400:3200::1]）；ULA / 链路本地 / 回环 / 无法判定的 NAT64、6to4 前缀拒绝。
    const verdict = classifyPublicV6(host);
    if (!verdict.ok) throw error(verdict.reason + ' ' + host);
    return url;
  }
  // 云元数据端点（含 metadata.google.internal）与安装入口共用同一名单，避免两张标准表漂移。
  if (isBlockedMetadataHost(host)) throw error('metadata endpoint');
  if (isPrivateNetworkHost(host)) throw error('private network');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const verdict = classifyPublicV4(host);
    if (!verdict.ok) throw error(verdict.reason + ' ' + host);
  }
  return url;
}

/**
 * 校验一个已解析的地址是否为公网：用于 DNS 解析结果与连接对端地址的判定。
 *
 * **能力边界（重要）**：本函数只做「给定地址是否公网」的判定，它本身不锁定连接目标。
 * 调用方若在「先解析、后连接」之间留下时间窗，理论上存在 DNS rebinding 的 TOCTOU 窗口
 * （第一次解析返回公网 IP 通过校验，实际连接时再次解析返回内网 IP）。
 * 因此它**降低而不是消除** rebinding 风险；要彻底杜绝需把解析结果固定下来喂给连接层
 * （自定义 dispatcher/agent 锁定 IP），当前未实现。
 *
 * @param {string} remoteAddress 连接的远端地址（形如 10.0.0.1 或 ::ffff:10.0.0.1）
 * @param {string} rawUrl 用于错误信息的原始 URL
 * @returns {{ address: string }} 允许时返回归一化后的地址
 * @throws 目标为回环/私网/链路本地/保留段时抛出 INSTALL_PEER_NOT_PUBLIC
 */
export function assertPublicPeerAddress(remoteAddress, rawUrl) {
  const host = normalizedHostname(remoteAddress);
  if (!host) {
    const failure = new Error('remote definition resolved to an unknown peer address: ' + rawUrl);
    failure.code = 'INSTALL_PEER_NOT_PUBLIC';
    throw failure;
  }
  const reject = (reason) => {
    const failure = new Error('remote definition resolved to a non-public address (' + reason + '): ' + rawUrl);
    failure.code = 'INSTALL_PEER_NOT_PUBLIC';
    return failure;
  };
  const mapped = mappedV4ToV4(host);
  if (mapped) {
    // 与公网 IPv4 分支复用同一判定（127/8、0/8 整段拦截）。
    const verdict = classifyPublicV4(mapped);
    if (!verdict.ok) throw reject(verdict.reason + ' ' + mapped);
    return { address: mapped };
  }
  if (host.includes(':')) {
    // NAT64(64:ff9b::/96) 与 6to4(2002::/16) 的内嵌 IPv4 才是实际连接目标：按 RFC 6052 / RFC 3056
    // 还原后走 classifyPublicV4。此前这类地址被原样放行，等于用 IPv6 外壳绕过公网判定。
    const hextets = expandIpv6(host);
    const embedded = nat64ToV4(hextets) ?? sixToFourToV4(hextets);
    if (embedded) {
      const verdict = classifyPublicV4(embedded);
      if (!verdict.ok) throw reject(verdict.reason + ' ' + embedded);
      return { address: embedded };
    }
    const verdict = classifyPublicV6(host);
    if (!verdict.ok) throw reject(verdict.reason + ' ' + host);
    return { address: host };
  }
  const verdict = classifyPublicV4(host);
  if (!verdict.ok) throw reject(verdict.reason + ' ' + host);
  return { address: host };
}

/** header 名白名单 */
export function assertSafeHeaderName(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(name))) {
    throw new Error(`invalid header name: ${name}`);
  }
  return String(name);
}
