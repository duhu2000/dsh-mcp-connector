// stdout is reserved for MCP JSON-RPC. No payloads or credentials are logged.
// Derived from the proven legacy stdio adapter: transparent unless --legacy
// is explicitly requested for a known initialize-era server.
import { spawn } from 'node:child_process';
import spawnServer from 'cross-spawn';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const timeoutMs = Number(argv[1]);
const legacy = argv[2] === '--legacy';
if (argv[0] !== '--timeout-ms' || separator !== (legacy ? 3 : 2)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 2_147_483_647 || !argv[separator + 1]) {
  process.stderr.write('[mcp-stdio-startup] Invalid invocation\n');
  process.exit(2);
}
const command = argv[separator + 1];
const args = argv.slice(separator + 2);
const startupMethods = new Set(['server/discover', 'initialize', 'tools/list']);
let child;
let stopping = false;
let discovered = false;
let killer;
let closeTimer;
const pending = new Map();
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

function clearPending() {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
}

function forceStop() {
  if (!child) return;
  if (process.platform === 'win32') {
    // Capture the tree while its root is alive; do not wait for a parent to
    // exit and leave unaddressable descendants behind.
    if (child.exitCode !== null || killer) return;
    killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => child.kill('SIGKILL'));
    killer.on('close', () => { killer = undefined; if (child.exitCode !== null) process.exit(process.exitCode ?? 0); });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

function stop(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  clearPending();
  if (reason) process.stderr.write(`[mcp-stdio-startup] ${reason}\n`);
  process.exitCode = code;
  if (!child || child.exitCode !== null) process.exit(code);
  if (process.platform === 'win32') forceStop();
  else child.stdin.end();
  closeTimer = setTimeout(forceStop, 300);
  // A broken descendant must not retain the transport indefinitely.
  setTimeout(() => process.exit(code), 2500).unref();
}

/**
 * Windows 上删除环境变量必须不区分大小写，否则 `Node_Options` 之类的写法会漏网。
 */
const DROP_ENV_PATTERN = /^(?:electron_run_as_node|node_options|node_extra_ca_certs|node_path|ld_.*|dyld_.*|perl5lib|perllib|perl5opt|pythonpath|pythonhome|pythonstartup|bash_env|env|gconv_path)$/i;

/**
 * 第三方 MCP server 是本机上的另一个程序，不该继承影响"加载什么代码"的变量：
 *
 *   - `ELECTRON_RUN_AS_NODE`：只用于让本守卫跑在 Node 上，漏出去会让 Electron 程序退化成 node；
 *   - `NODE_OPTIONS` / `NODE_EXTRA_CA_CERTS`：可注入 `--require` / 替换信任根；
 *   - `LD_*` / `DYLD_*`：动态链接器预加载，等于任意代码执行；
 *   - `PYTHONPATH` / `PERL5LIB` 等：等价于模块劫持。
 *
 * 默认只剥离这些**继承自父进程**的变量；连接配置里显式声明的同名变量（例如用户确实
 * 需要把 PYTHONPATH 指向自定义解释器路径）会保留，尊重显式意图。
 * 显式 key 列表由 mcp-provision.js 通过 DSH_STDIO_EXPLICIT_ENV 传入（逗号分隔）。
 */
function serverEnv() {
  const explicit = new Set(
    String(process.env.DSH_STDIO_EXPLICIT_ENV ?? '')
      .split(',')
      .map((key) => key.trim().toLowerCase())
      .filter(Boolean),
  );
  const env = { ...process.env };
  // 该标记只服务于守卫自身，绝不透传给第三方 server。
  delete env.DSH_STDIO_EXPLICIT_ENV;
  for (const key of Object.keys(env)) {
    // 危险加载器变量**永远**剥离：显式声明不构成豁免。
    //
    // 原实现让 explicit 先短路，结果远端卡片只要在 servers[].env 里写
    // NODE_OPTIONS=--require=/evil.js 或 LD_PRELOAD=/evil.so，就会被
    // mcp-provision.js 拼进 DSH_STDIO_EXPLICIT_ENV，守卫这里直接 continue 跳过剥离
    // —— 本 PR 的 env 加固被自己的豁免机制打穿（实测缺陷 S-4）。
    // 用户若真的需要自定义解释器路径，应显式改 command/args，而不是靠注入 loader 变量。
    if (DROP_ENV_PATTERN.test(key)) { delete env[key]; continue; }
    if (explicit.has(key.toLowerCase())) continue; // 其余键：连接级显式配置，保留
  }
  return env;
}

function launch() {
  let launchFailed = false;
  let protocolSeen = false;
  let startupStderr = '';
  const flushStderr = () => {
    if (!launchFailed && startupStderr) process.stderr.write(startupStderr);
    startupStderr = '';
  };
  child = spawnServer(command, args, {
    cwd: process.cwd(), env: serverEnv(),
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    detached: process.platform !== 'win32',
  });
  child.stderr.on('data', (data) => {
    if (launchFailed) return;
    if (protocolSeen) process.stderr.write(data);
    else startupStderr = (startupStderr + data.toString()).slice(-65536);
  });
  child.on('error', (error) => {
    launchFailed = true;
    startupStderr = '';
    stop(error.code === 'ENOENT'
    ? 'Server launch failed (ENOENT): check the executable and PATH on the DSH host'
    : 'Server launch failed', 1);
  });
  child.stdin.on('error', () => stop('Server input closed', 1));
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      protocolSeen = true;
      flushStderr();
      if (Object.hasOwn(message, 'id') && !message.method) {
        const request = pending.get(message.id);
        if (request) {
          clearTimeout(request.timer);
          pending.delete(message.id);
          if (request.method === 'tools/list' && !message.error && !message.result?.nextCursor) {
            discovered = true;
            clearPending();
          }
        }
      }
    } catch { /* The SDK reports non-protocol stdout, without leaking it here. */ }
    if (!stopping) process.stdout.write(`${line}\n`);
  });
  child.on('close', (code) => {
    flushStderr();
    clearPending();
    clearTimeout(closeTimer);
    // A parent may exit on EOF while descendants remain in its process group.
    if (process.platform !== 'win32') forceStop();
    if (!killer) process.exit(stopping ? (process.exitCode ?? 0) : (code ?? 1));
  });
}

process.stdout.on('error', () => stop(undefined, 0));
process.on('SIGTERM', () => stop(undefined, 0));
process.on('SIGINT', () => stop(undefined, 0));
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('close', () => stop(undefined, 0));
input.on('line', (line) => {
  if (stopping || !line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { stop('Invalid JSON-RPC input', 1); return; }
  if (legacy && message.method === 'server/discover' && Object.hasOwn(message, 'id')) {
    write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Legacy MCP server: use initialize' } });
    return;
  }
  if (!child) launch();
  if (stopping) return;
  if (!discovered && startupMethods.has(message.method) && Object.hasOwn(message, 'id')) {
    clearTimeout(pending.get(message.id)?.timer);
    const timer = setTimeout(() => stop(`${message.method} exceeded ${timeoutMs}ms; stopped server`, 1), timeoutMs);
    pending.set(message.id, { method: message.method, timer });
  }
  child.stdin.write(`${line}\n`);
});
