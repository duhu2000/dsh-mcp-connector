/** Local, profile-scoped facts. No network, account IDs, credentials or business data. */
import { z } from 'zod';
export const connectionStatisticSchema = z.object({
  connectorId: z.string().min(1).max(256),
  firstObservedAt: z.number().int().nonnegative(),
  baseline: z.boolean(),
  firstSuccessAt: z.number().int().nonnegative().nullable(),
});
export class ConnectionStatistics {
  constructor(table, { now = Date.now } = {}) {
    this.table = table;
    this.now = now;
    this.records = new Map();
    this.queue = Promise.resolve();
    this.available = true;
  }
  async load() {
    for (const [key, raw] of this.table.entries()) {
      const result = connectionStatisticSchema.safeParse(raw);
      if (!result.success || key !== result.data.connectorId) throw Error('Invalid connection statistics');
      this.records.set(key, result.data);
    }
  }
  write(action) {
    const pending = this.queue.catch(() => {}).then(action);
    this.queue = pending;
    return pending;
  }
  async put(record) {
    // Publish memory only after durable storage succeeds.
    const safe = connectionStatisticSchema.parse(record);
    await this.table.put(safe.connectorId, safe);
    this.records.set(safe.connectorId, safe);
  }
  baseline(ids) {
    return this.write(async () => {
      for (const id of new Set(ids)) {
        if (!this.records.has(id)) await this.put({ connectorId: id, firstObservedAt: this.now(), baseline: true, firstSuccessAt: null });
      }
    });
  }
  success(id) {
    return this.write(async () => {
      const existing = this.records.get(id);
      if (existing?.firstSuccessAt != null) return;
      await this.put({ connectorId: id, firstObservedAt: existing?.firstObservedAt ?? this.now(), baseline: existing?.baseline ?? false, firstSuccessAt: this.now() });
    });
  }
  snapshot() {
    const cutoff = this.now() - 30 * 86400000;
    const items = [...this.records.values()].map(r => ({
      connectorId: r.connectorId,
      cumulativeSuccessfulConnections: r.firstSuccessAt == null ? 0 : 1,
      newSuccessfulConnections30d: !r.baseline && r.firstSuccessAt != null && r.firstSuccessAt >= cutoff ? 1 : 0,
      historicalBaseline: r.baseline,
    }));
    return { scope: 'local-profile', reportingEnabled: false, available: this.available,
      cumulativeSuccessfulConnections: items.reduce((n, r) => n + r.cumulativeSuccessfulConnections, 0),
      newSuccessfulConnections30d: items.reduce((n, r) => n + r.newSuccessfulConnections30d, 0),
      historicalBaseline: items.filter(r => r.historicalBaseline).length, items };
  }
}

/** Wrap final outcomes, not saves: rollback, cancelled OAuth and validation errors never count. */
export function observeConnectionSuccess(api, statistics, { known, onError = () => {} }) {
  for (const method of ['connect', 'configure']) {
    const action = api[method];
    api[method] = async function (...args) {
      const id = method === 'connect' ? args[0] : args[0]?.connectorId;
      const result = await action.apply(this, args);
      if (statistics.available && result?.ok === true && typeof id === 'string' && known(id)) {
        let timer;
        try {
          await Promise.race([statistics.success(id), new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('Statistics timeout')), 1000);
          })]);
        }
        catch { statistics.available = false; onError(); }
        finally { clearTimeout(timer); }
      }
      return result;
    };
  }
}
