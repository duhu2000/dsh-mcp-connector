/** OAuth Grant 刷新失败分类、日志脱敏与重试退避。 */

const PERMANENT_REFRESH_CODES = new Set([
  'invalid_grant',
  'invalid_token',
  'invalid_client',
  'unauthorized_client',
  'invalid_scope',
  'client_secret_expired',
  'missing_refresh_token',
]);

/** 防止 OAuth 服务端错误描述意外回显凭据。 */
export function redactOAuthDetail(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:access_token|refresh_token|client_secret|code)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/((?:access_token|refresh_token|client_secret)\s*[=:]\s*)[^\s,;&}]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}

/**
 * 只有明确表示 Refresh Token / 动态客户端不可恢复的 OAuth 错误才要求重新授权。
 * 网络、发现端点、5xx、超时和未知服务端错误都按暂时故障自动重试。
 */
export function classifyRefreshFailure(error) {
  const code = typeof error?.code === 'string' && error.code
    ? redactOAuthDetail(error.code).slice(0, 80)
    : error?.name === 'OAuthNetworkError' ? 'network_error' : 'refresh_failed';
  const httpStatus = Number.isInteger(error?.httpStatus) ? error.httpStatus : undefined;
  const permanent = PERMANENT_REFRESH_CODES.has(code) || httpStatus === 401 || httpStatus === 403;
  return {
    permanent,
    kind: permanent ? 'permanent' : 'transient',
    code,
    httpStatus,
    message: redactOAuthDetail(error?.message || code),
  };
}

/** 指数退避：base、2×、4×……，封顶 max。failureCount 从 1 开始。 */
export function refreshRetryDelay(failureCount, baseMs, maxMs) {
  const base = Math.max(1_000, Number(baseMs) || 30_000);
  const max = Math.max(base, Number(maxMs) || 300_000);
  const exponent = Math.max(0, Math.min(20, Number(failureCount || 1) - 1));
  return Math.min(max, base * (2 ** exponent));
}
