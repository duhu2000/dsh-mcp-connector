import { parentPort, workerData } from 'node:worker_threads';
import { createReadOnlyEvidenceVerifier } from '../../lib/read-only-evidence.js';
const verifier = await createReadOnlyEvidenceVerifier(workerData);
parentPort.postMessage(verifier.status()); verifier.close();
