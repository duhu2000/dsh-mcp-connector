import { win32 } from 'node:path';

/** QA archives use native Windows tar: GNU tar treats a drive colon as a host. */
export function packageTarExecutable({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return 'tar';
  const variable = (name) => Object.entries(env).find(([key]) => key.toLowerCase() === name)?.[1];
  const systemRoot = variable('systemroot') || variable('windir');
  if (typeof systemRoot !== 'string' || !/^[A-Za-z]:[\\/]/.test(systemRoot) || !win32.isAbsolute(systemRoot)) {
    throw new Error('Native Windows tar requires an absolute SystemRoot or WINDIR; PATH fallback is disabled');
  }
  return win32.join(systemRoot, 'System32', 'tar.exe');
}
