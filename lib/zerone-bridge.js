/** Compatibility entry point for the two existing Zerone bridges. */
import { createQueryAuthBridge } from './query-auth-bridge.js';
export function createZeroneBridge({ service, ...options } = {}) {
  if (!['pe', 'base'].includes(service)) throw new Error('Choose --service pe or base');
  return createQueryAuthBridge({ ...options, profile: `zerone-${service}` });
}
