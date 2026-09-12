// Pure scheduling policy. No credentials, timers or network operations.
export function nextDiscovery(previous, outcome, now = Date.now()) {
  const failures = outcome.ok ? 0 : Math.min((previous?.failures || 0) + 1, 10);
  if (outcome.errorKind === 'auth') return { failures, nextAt: null, reason: 'auth' };
  const rateLimited = outcome.errorKind === 'rate-limit';
  const delay = outcome.ok ? 300_000 : Math.min((rateLimited ? 60_000 : 30_000) * 2 ** (failures - 1), 900_000);
  const retry = Number.isFinite(outcome.retryAfterMs) ? Math.max(0, outcome.retryAfterMs) : 0;
  return { failures, nextAt: now + Math.max(delay, retry), reason: outcome.ok ? 'success' : rateLimited ? 'rate-limit' : 'retry' };
}

export function discoveryDue(plan, now = Date.now()) {
  return !plan || (plan.nextAt !== null && plan.nextAt <= now);
}

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  // Bound untrusted headers; malformed/negative values fall back to local backoff.
  return Number.isFinite(delay) ? Math.max(0, Math.min(delay, 86_400_000)) : 0;
}
