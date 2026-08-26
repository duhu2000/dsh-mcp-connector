import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRefreshFailure, redactOAuthDetail, refreshRetryDelay } from '../lib/grant-lifecycle.js';
import { OAuthError, OAuthNetworkError } from '../lib/oauth.js';

test('OAuth 刷新失败只把明确不可恢复错误分类为重新授权', () => {
  assert.equal(classifyRefreshFailure(new OAuthError('invalid_grant', 'expired')).permanent, true);
  assert.equal(classifyRefreshFailure(new OAuthError('invalid_client', 'removed', 401)).permanent, true);
  assert.equal(classifyRefreshFailure(new OAuthError('invalid_token', 'expired')).permanent, true);
  assert.equal(classifyRefreshFailure(new OAuthError('server_error', 'outage', 503)).permanent, false);
  assert.equal(classifyRefreshFailure(new OAuthNetworkError('request failed', new Error('offline'))).permanent, false);
});

test('OAuth 刷新日志会清除 Bearer、Refresh Token 与 Client Secret', () => {
  const input = 'Bearer abc123 refresh_token=sensitive&client_secret=hidden&code=once';
  const output = redactOAuthDetail(input);
  assert.doesNotMatch(output, /abc123|sensitive|hidden|once/);
  assert.match(output, /\[REDACTED\]/);
});

test('OAuth 刷新重试采用有上限的指数退避', () => {
  assert.equal(refreshRetryDelay(1, 30_000, 300_000), 30_000);
  assert.equal(refreshRetryDelay(2, 30_000, 300_000), 60_000);
  assert.equal(refreshRetryDelay(10, 30_000, 300_000), 300_000);
});
