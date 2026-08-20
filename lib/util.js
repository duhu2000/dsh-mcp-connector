/**
 * 平台工具：打开系统默认浏览器（macOS/Linux/Windows）+ 通用小工具。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

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

/** URL 协议白名单：仅 https / 回环 http */
export function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`invalid url: ${rawUrl}`);
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return url;
  throw new Error(`url protocol not allowed (only https or loopback http): ${rawUrl}`);
}

/** header 名白名单 */
export function assertSafeHeaderName(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(name))) {
    throw new Error(`invalid header name: ${name}`);
  }
  return String(name);
}
