export function readOnlyReviewFor(scope, source, extra = {}) {
  return { version: 1, accountRef: scope.accountRef, groupId: scope.groupId,
    sourceId: source.sourceId, definitionFingerprint: source.definitionFingerprint,
    enabled: true, validFrom: 10, expiresAt: 10000,
    review: { effect: 'read-only', evidenceHash: 'c'.repeat(64), reviewedAt: 10 }, ...extra };
}
