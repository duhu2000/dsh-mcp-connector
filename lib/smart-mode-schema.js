import { z } from 'zod';

export const SMART_MODE_SNAPSHOT_VERSION = 1;
export const SMART_MODE_STORE_VERSION = 1;
export const SMART_MODE_DOMAIN_NAME = 'mcp_connector_smart_v1';

const reference = z.string().min(1).max(512);
export const smartModeSnapshotSchema = z.object({
  version: z.literal(SMART_MODE_SNAPSHOT_VERSION),
  sessionId: reference,
  mode: z.enum(['compat', 'smart']),
  policyVersion: reference,
  selection: z.enum(['legacy', 'smart-auto', 'user-confirmed', 'parent']),
  accountRef: reference.optional(),
  groupId: reference.optional(),
  policyRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).superRefine((value, ctx) => {
  if (value.mode === 'smart' && (!value.accountRef || !value.groupId)) {
    ctx.addIssue({ code: 'custom', message: 'Smart mode requires an account/group binding' });
  }
  if ((value.accountRef === undefined) !== (value.groupId === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Account and group references must be paired' });
  }
});

export const smartModeDefaultPolicySchema = z.strictObject({
  version: z.literal(SMART_MODE_STORE_VERSION),
  accountRef: reference,
  groupId: reference,
  mode: z.enum(['compat', 'smart']),
  policyVersion: reference,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export function smartModeError(code, cause) {
  return Object.assign(new Error(`Smart mode storage: ${code}`, cause ? { cause } : {}), { code });
}

export function normalizeSmartModeSnapshot(value, sessionId, { strict = false } = {}) {
  const parsed = (strict ? smartModeSnapshotSchema.strict() : smartModeSnapshotSchema).safeParse(value);
  if (!parsed.success || parsed.data.sessionId !== sessionId) throw smartModeError('INVALID_SNAPSHOT');
  // A compat default retains its policy binding for stale-revision checks;
  // historical compat snapshots remain unbound. This grants no tool access.
  return Object.freeze(parsed.data);
}
