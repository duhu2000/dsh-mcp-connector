/**
 * 携凭据请求的重定向处理。
 *
 * 背景：Node 的 fetch（undici）在**跨源**重定向时只剥离 `authorization` 与 `cookie`，
 * 其余自定义鉴权头（`x-api-key`、`x-org-key`、目录卡片声明的头）与 `Mcp-Session-Id`
 * 会被继续发送到跳转目标，构成凭据外泄通道。因此凡是携带鉴权头的请求都必须显式处理跳转。
 *
 * 本模块把「策略」与「执行」分开：
 *   - `util.js` 的 `resolveCredentialedRedirect` 只做**单跳是否允许**的判定（同源/跨源/上限）；
 *   - 本模块按 Fetch 规范重放请求。改用 GET 时，移除请求体及其相关头。
 *     所有被替换、被拒绝或超限的响应体一律取消。
 *
 * 单独成文件的原因：`mcp-http.js` 与 `mcp-validation.js` 都需要这套逻辑，
 * 而两者互相独立（validation 不应 import http 客户端）。
 */
import { assertConnectionUrl, isSameOrigin, resolveCredentialedRedirect } from './util.js';

const REQUEST_BODY_HEADERS = [
  'content-encoding',
  'content-language',
  'content-location',
  'content-type',
  // 显式提供 Content-Length 时，Node 的 Fetch 也会在改用 GET 时删除它。
  'content-length',
];

/** 跳转失败的稳定错误码，供上层把「策略拒绝」与「网络故障」区分开。 */
export const REDIRECT_ERROR_CODES = Object.freeze({
  CROSS_ORIGIN: 'CREDENTIALED_REDIRECT_CROSS_ORIGIN',
  TOO_MANY: 'CREDENTIALED_REDIRECT_TOO_MANY',
  INVALID: 'CREDENTIALED_REDIRECT_INVALID',
});

/**
 * 判断一次跳转是否需要改用 GET。
 *
 * @param {number} status 3xx 状态码
 * @param {string} method 原方法
 * @returns {boolean}
 */
export function shouldRewriteToGet(status, method) {
  const code = Number(status);
  const originalMethod = String(method).toUpperCase();
  if (code === 303) return originalMethod !== 'GET' && originalMethod !== 'HEAD';
  return (code === 301 || code === 302) && originalMethod === 'POST';
}

/**
 * 取消响应体。取消本身可能因流已结束/已锁定而抛错，这里一律忽略——
 * 目的是释放连接，不是传播错误。
 *
 * @param {Response | undefined} response
 */
export async function cancelBody(response) {
  try {
    await response?.body?.cancel();
  } catch {
    // 已消费或已锁定：无需再处理。
  }
}

/**
 * 判断一次 3xx 被拒绝的具体原因。
 *
 * `resolveCredentialedRedirect` 抛出的错误只有人类可读文案；这里结合实际响应
 * 复算一次原因，给出稳定 code，避免上层用正则匹配中文。
 *
 * @returns {string} `REDIRECT_ERROR_CODES` 中的一项
 */
function redirectFailureCode(response, currentUrl, hops, maxHops) {
  const location = response?.headers?.get?.('location');
  if (!location) return REDIRECT_ERROR_CODES.INVALID;
  if (hops >= maxHops) return REDIRECT_ERROR_CODES.TOO_MANY;
  try {
    const target = new URL(location, currentUrl).toString();
    if (!isSameOrigin(currentUrl, target)) return REDIRECT_ERROR_CODES.CROSS_ORIGIN;
  } catch {
    return REDIRECT_ERROR_CODES.INVALID;
  }
  return REDIRECT_ERROR_CODES.INVALID;
}

/**
 * 带凭据地发送请求，并按同源单跳策略处理重定向。
 *
 * 返回的 `response` 一定是**最终**（非 3xx）响应，调用方可以直接读取。
 * 所有中间响应体都已在内部取消，不会泄漏连接。
 *
 * @param {(url: string, init: RequestInit) => Promise<Response>} fetchImpl
 * @param {string} url 起始 URL
 * @param {object} init 请求参数（method / headers / body / signal 等；`redirect` 由本函数接管）
 * @param {{
 *   t?: (msgid: string, params?: object) => string,
 *   allowInsecurePrivateNetwork?: boolean,
 *   maxHops?: number,
 * }} [options]
 * @returns {Promise<Response>}
 * @throws {Error & { code: string }} 跳转被拒绝时抛出带 `code` 的错误
 */
export async function fetchCredentialed(fetchImpl, url, init, {
  t,
  allowInsecurePrivateNetwork = false,
  maxHops = 1,
} = {}) {
  let currentUrl = url;
  let method = String(init?.method ?? 'GET').toUpperCase();
  let body = init?.body;
  let headers = init?.headers;
  let response = await fetchImpl(currentUrl, { ...init, method, body, redirect: 'manual' });

  for (let hops = 0; ; hops += 1) {
    let hop;
    try {
      hop = resolveCredentialedRedirect(response, currentUrl, {
        t,
        allowInsecurePrivateNetwork,
        maxHops,
        hops,
      });
    } catch (error) {
      // 拒绝跨源 / 缺 Location / 超出跳数：这个响应不会有人读取，
      // 必须显式取消，否则每次校验都会留下一条未关闭的连接。
      await cancelBody(response);
      const failure = new Error(error instanceof Error ? error.message : String(error), { cause: error });
      failure.name = 'CredentialedRedirectError';
      failure.code = redirectFailureCode(response, currentUrl, hops, maxHops);
      throw failure;
    }

    if (!hop.follow) return response;

    const status = Number(response.status);
    // 无论是否改方法，被放弃的这个响应都必须取消，否则连接会挂到 GC。
    await cancelBody(response);

    if (shouldRewriteToGet(status, method)) {
      method = 'GET';
      body = undefined;
      headers = new Headers(headers);
      for (const name of REQUEST_BODY_HEADERS) headers.delete(name);
    }

    // 目标必须重新过连接校验（resolveCredentialedRedirect 已做过一次，
    // 这里再断言一次成本很低，且能覆盖未来调用方直接传 URL 的情况）。
    assertConnectionUrl(hop.url, { allowInsecurePrivateNetwork });

    currentUrl = hop.url;
    const nextInit = { ...init, method, headers, redirect: 'manual' };
    if (body === undefined) delete nextInit.body;
    else nextInit.body = body;

    response = await fetchImpl(currentUrl, nextInit);
  }
}
