import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { readOnlyEvidenceDirectory, readOnlyEvidenceSigningBytes } from '../../lib/read-only-evidence.js';
import { readOnlyReviewFor } from './read-only-review.mjs';

/** Synthetic authority only. Private keys stay in this test process. */
export async function signedEvidenceFixture(profileDir, scope, sources, at = Date.now()) {
  if (scope.accountRef !== 'synthetic-grant-a' || sources.some((source) => !source.rawName.startsWith('fixture_'))) throw new Error('Synthetic evidence only');
  const keys = generateKeyPairSync('ed25519');
  const directory = readOnlyEvidenceDirectory(profileDir);
  const trust = { version: 1, accountRef: scope.accountRef, groupId: scope.groupId, profileBinding: 'b'.repeat(64),
    keys: [{ id: 'synthetic-reviewer', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), enabled: true, notBefore: 0, expiresAt: at + 7 * 86400000 }] };
  const payload = { version: 1, purpose: 'dsh-read-only-evidence-v1', accountRef: scope.accountRef, groupId: scope.groupId,
    profileBinding: trust.profileBinding, revision: 1, issuedAt: at, notBefore: at - 10000, expiresAt: at + 2 * 86400000,
    reviews: sources.map((source) => readOnlyReviewFor(scope, source, { validFrom: at - 10000, expiresAt: at + 2 * 86400000,
      review: { effect: 'read-only', evidenceHash: 'c'.repeat(64), reviewedAt: at - 10000, reviewerHash: 'd'.repeat(64) } })) };
  async function write(name, value) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temp = join(directory, `.pending-${randomUUID()}`);
    await writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(temp, join(directory, name));
  }
  const bundle = (value = payload, keyId = trust.keys[0].id) => ({ keyId, payload: value,
    signature: sign(null, readOnlyEvidenceSigningBytes(value), keys.privateKey).toString('base64') });
  await write('trust.json', trust);
  return { directory, trust, payload, bundle, write, deliver: (value = payload) => write('bundle.json', bundle(value)) };
}
