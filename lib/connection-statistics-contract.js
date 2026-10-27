/** Proposed community contract. Pure validation only: no identity creation or network IO. */
import { z } from 'zod';
const id = z.string().min(1).max(256);
const instant = z.string().datetime();
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
export const connectionEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  instanceId: z.string().uuid(),
  connectorId: id,
  eventType: z.enum(['first_success', 'baseline_success']),
  occurredAt: instant,
  pluginVersion: z.string().max(80).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
}).strict();
export const connectionReceiptSchema = z.object({
  ok: z.literal(true), status: z.enum(['accepted', 'duplicate']),
}).strict();
const itemSchema = z.object({
  connectorId: id, cumulativeSuccessfulConnections: count, newSuccessfulConnections30d: count,
}).strict().refine(x => x.cumulativeSuccessfulConnections === null || x.newSuccessfulConnections30d === null || x.newSuccessfulConnections30d <= x.cumulativeSuccessfulConnections);
export const connectionAggregateSchema = z.object({
  schemaVersion: z.literal(1), scope: z.literal('participating-instances'),
  startedAt: instant, updatedAt: instant, items: z.array(itemSchema).max(10000),
}).strict().refine(x => Date.parse(x.startedAt) <= Date.parse(x.updatedAt))
  .refine(x => new Set(x.items.map(i => i.connectorId)).size === x.items.length);

// Return fixed diagnostics, never echo a rejected payload containing private data.
export function validateConnectionEvent(raw, { publicIds, now, maxAgeMs, futureSkewMs }) {
  if (!(publicIds instanceof Set) || ![now, maxAgeMs, futureSkewMs].every(x => Number.isSafeInteger(x) && x >= 0)) {
    throw new TypeError('Explicit public catalog and time policy required');
  }
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 4096) return { ok: false, code: 'invalid_body' };
  let parsed;
  try { parsed = connectionEventSchema.safeParse(JSON.parse(raw)); }
  catch { return { ok: false, code: 'invalid_body' }; }
  if (!parsed.success) return { ok: false, code: 'invalid_fields' };
  if (!publicIds.has(parsed.data.connectorId)) return { ok: false, code: 'unknown_connector' };
  const time = Date.parse(parsed.data.occurredAt);
  if (time < now - maxAgeMs || time > now + futureSkewMs) return { ok: false, code: 'invalid_time' };
  return { ok: true, event: parsed.data };
}
