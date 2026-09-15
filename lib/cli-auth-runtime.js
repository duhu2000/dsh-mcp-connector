import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

export const DWS_AUTH_VERSION = '1.0.61';

/** Resolve only an explicitly selected installed official package, never PATH. */
export async function resolveDwsAuthRuntime(packageDir, platform = process.platform) {
  if (!['darwin', 'linux'].includes(platform)) throw new Error('CLI_AUTH_PLATFORM_UNVERIFIED');
  if (typeof packageDir !== 'string' || !isAbsolute(packageDir)) throw new Error('CLI_AUTH_PACKAGE_REQUIRED');
  const root = await realpath(packageDir);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'dingtalk-workspace-cli' || manifest.version !== DWS_AUTH_VERSION) {
    throw new Error('CLI_AUTH_PACKAGE_VERSION_MISMATCH');
  }
  const executable = await realpath(join(root, 'vendor', 'dws'));
  const rel = relative(root, executable);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('CLI_AUTH_PACKAGE_ESCAPE');
  return executable;
}

/** Owned process group; login output is discarded, status output stays internal. */
export function runDwsAuthProcess(executable, operation, {
  signal, spawnImpl = spawn, killGroup = process.kill.bind(process),
  platform = process.platform, graceMs = 1500,
} = {}) {
  if (!['darwin', 'linux'].includes(platform)) return Promise.reject(new Error('CLI_AUTH_PLATFORM_UNVERIFIED'));
  if (!isAbsolute(executable)) return Promise.reject(new Error('CLI_AUTH_EXECUTABLE_REQUIRED'));
  if (!['login', 'status'].includes(operation)) return Promise.reject(new Error('CLI_AUTH_OPERATION_INVALID'));
  if (signal?.aborted) return Promise.reject(new Error('CLI_AUTH_CANCELLED'));
  const args = ['auth', operation, '--format', 'json'];
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(executable, args, {
        shell: false, detached: true, windowsHide: true,
        stdio: ['ignore', operation === 'status' ? 'pipe' : 'ignore', 'ignore'],
      });
    } catch { reject(new Error('CLI_AUTH_START_FAILED')); return; }
    let forced;
    let done = false;
    let failure;
    let size = 0;
    const chunks = [];
    const kill = (sig) => {
      if (!Number.isInteger(child.pid) || child.pid <= 0) return;
      try { killGroup(-child.pid, sig); } catch (error) {
        if (error?.code !== 'ESRCH') failure = 'CLI_AUTH_CLEANUP_FAILED';
      }
    };
    const abort = () => {
      if (done || forced) return;
      failure ??= 'CLI_AUTH_CANCELLED';
      kill('SIGTERM');
      forced = setTimeout(() => kill('SIGKILL'), graceMs);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout?.on('data', (chunk) => {
      size += chunk.length;
      if (size > 65536) { failure = 'CLI_AUTH_OUTPUT_LIMIT'; abort(); return; }
      chunks.push(chunk);
    });
    const finish = (code, error) => {
      if (done) return;
      done = true;
      clearTimeout(forced);
      signal?.removeEventListener('abort', abort);
      if (error || failure) { reject(new Error(failure || 'CLI_AUTH_START_FAILED')); return; }
      if (operation === 'login') { resolve({ exitCode: code }); return; }
      if (code !== 0) { reject(new Error('CLI_AUTH_STATUS_FAILED')); return; }
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        // Preserve unknown values as unknown, rather than coercing false/true.
        resolve({ success: data?.success === true,
          authenticated: typeof data?.authenticated === 'boolean' ? data.authenticated : undefined });
      } catch { reject(new Error('CLI_AUTH_STATUS_INVALID')); }
    };
    child.once('error', () => finish(null, true));
    child.once('close', (code) => finish(code));
  });
}

export async function createDwsAuthAdapters(packageDir) {
  const executable = await resolveDwsAuthRuntime(packageDir);
  return {
    launch: ({ signal }) => runDwsAuthProcess(executable, 'login', { signal }),
    verify: ({ signal }) => runDwsAuthProcess(executable, 'status', { signal }),
  };
}
