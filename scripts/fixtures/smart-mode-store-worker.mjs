// Offline child-process fixture. Never resolve a profile or credential itself.
import * as filesystem from 'node:fs/promises';
import { SmartModeStore } from '../../lib/smart-mode-store.js';

let continueWrite;
process.on('message', async (message) => {
  if (message.type === 'continue') { continueWrite?.(); return; }
  if (message.type !== 'run') return;
  const { profileDir, operation, value, expectedRevision, crashPoint } = message;
  const io = { ...filesystem, async link(from, to) {
    const record = !to.endsWith('domain.json');
    if (record && crashPoint === 'before-publish') {
      await new Promise((resolve) => { continueWrite = resolve; process.send({ type: 'checkpoint' }); });
    }
    await filesystem.link(from, to);
    if (record && crashPoint === 'after-publish') {
      await new Promise((resolve) => { continueWrite = resolve; process.send({ type: 'checkpoint' }); });
    }
  } };
  let store;
  try {
    store = await SmartModeStore.open({ profileDir, io });
    const result = operation === 'snapshot' ? await store.writeSnapshot(value)
      : operation === 'default' ? await store.setDefaultPolicy(value, { expectedRevision })
        : operation === 'relation' ? await store.setSourceRelation(value, { expectedRevision })
        : await store.readSnapshot(value);
    await store.close();
    process.send({ type: 'result', ok: true, result });
  } catch (error) {
    await store?.close();
    process.send({ type: 'result', ok: false, code: error.code });
  }
});
process.send({ type: 'ready' });
