/**
 * stdio 启动确认墙回归测试（PR #287）。
 *
 * 背景：lib/index.js 新增了 evaluateStdioConfirmation / stdioLaunchFingerprint /
 * confirmStdioLaunch / describeLaunchEnv，但 test/ 全目录对它们零断言，
 * 导致 4 条实测绕过长期没被发现：
 *   S-1 远端 registry 卡片里的 stdio 卡片 connect 即执行（确认墙只认 state.dynamic）；
 *   S-2 installFromUrl 之后用 configure 直接挂载，跳过 confirmStdioLaunch；
 *   S-3 确认后 applyLocalOverrides 改 args/env 不使指纹失效（确认 A、执行 B）；
 *   S-4 多 stdio server 卡片只确认第一条，其余 server 照样挂载。
 *
 * 本机禁止 child_process.spawn（EPERM），所以全程使用假 Host ctx：
 * loader.create/update 只记录条目配置（等价于「一旦被 Host 加载就会启动」的证据），
 * 不真正拉起进程；installFromUrl 的 fetch 用 t.mock.method 接管。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, stdioLaunchFingerprint, describeLaunchEnv } from '../lib/index.js';

/* ───────────────────────── 假 Host ctx ───────────────────────── */

function makeTable() {
  const map = new Map();
  return {
    async get(key) { return map.get(key); },
    async put(key, value) { map.set(key, value); },
    async delete(key) { return map.delete(key); },
    entries() { return [...map.entries()][Symbol.iterator](); },
  };
}

function makeLoader() {
  const entries = new Map();
  return {
    entries,
    async create({ id, name, config, disabled }) { entries.set(id, { id, name, options: { config }, disabled }); },
    async update(id, patch) {
      const entry = entries.get(id);
      if (!entry) throw new Error('entry ' + id + ' not found');
      if ('config' in patch) entry.options.config = patch.config;
      if ('disabled' in patch) entry.disabled = patch.disabled;
    },
    async remove(id) { entries.delete(id); },
    resolve(id) {
      const entry = entries.get(id);
      if (!entry) throw new Error('entry ' + id + ' not found');
      return entry;
    },
  };
}

function makeToolsRegistry() {
  const defs = new Map();
  return {
    defs,
    register(def) { defs.set(def.name, def); return () => defs.delete(def.name); },
    schemas() { return [...defs.values()].map(({ name, description = '', parameters = {} }) => ({ name, description, parameters })); },
  };
}

function makePluginContext({ shared } = {}) {
  const logs = [];
  const loader = makeLoader();
  const tools = makeToolsRegistry();
  const tables = shared?.tables ?? new Map([
    ['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()],
    ['snapshots', makeTable()], ['governance', makeTable()], ['connection_scopes', makeTable()],
    ['tool_catalog', makeTable()], ['connection_statistics', makeTable()],
  ]);
  const domain = { tables, close: async () => {} };
  const disposers = [];
  const routes = new Map();
  const ctx = {
    loader,
    tools,
    storageDomain: { open: async () => domain },
    workspaceRegistry: {
      list: () => [{ id: 'workspace-1', title: 'Workspace 1', path: process.cwd(), sessionIds: [] }],
      get(id) { return this.list().find((workspace) => String(workspace.id) === String(id)); },
    },
    logger: () => ({
      info: (m) => logs.push('[info] ' + m),
      warn: (m) => logs.push('[warn] ' + m),
      error: (m) => logs.push('[error] ' + m),
    }),
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
    },
    inject(dependencies, callback) {
      if (!dependencies.includes('webServer') || !dependencies.includes('webRuntime')) return;
      callback({
        effect: ctx.effect,
        webRuntime: {},
        webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
      });
    },
  };
  async function webCall(method, params = {}) {
    const req = {
      method: 'POST',
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ method, params })); },
    };
    let output;
    await routes.get('/mcp-connector/api')(req, { writeHead() {}, end(body) { output = JSON.parse(body); } });
    return output;
  }
  return { ctx, loader, tools, tables, logs, disposers, webCall };
}

function baseConfig(overrides = {}) {
  return {
    catalogUrl: '',
    catalogTtlMs: 3600_000,
    connectors: [],
    persistSecrets: true,
    entryPrefix: 'mcp',
    callbackTimeoutMs: 30_000,
    requestTimeoutMs: 5_000,
    refreshSkewMs: 300_000,
    openBrowser: false,
    account: 'default',
    ...overrides,
  };
}

const execute = (host, name, input = {}) => host.tools.defs.get('mcp_connector_' + name).execute(input, { signal: undefined });

/* ───────────────────────── 卡片构造 ───────────────────────── */

/** 远端 stdio server：command/args 就是将在本机执行的命令。 */
function stdioServer(serverKey, { command = 'node', args = ['server.js'], env, cwd, serverName } = {}) {
  return {
    serverKey,
    serverName: serverName ?? 'remote-' + serverKey,
    transport: 'stdio',
    command,
    args: [...args],
    ...(env === undefined ? {} : { env }),
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function stdioCard(id, servers, extra = {}) {
  return { id, name: 'Card ' + id, auth: { mode: 'none' }, servers, ...extra };
}

/** 让 installFromUrl 拿到指定卡片：只接管 globalThis.fetch 的卡片下载。 */
function mockCardFetch(t, cards) {
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input?.url ?? input);
    const card = cards[url];
    if (!card) throw new Error('unexpected fetch: ' + url);
    const response = new Response(JSON.stringify(card), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    // installFromUrl 会用 response.url 再跑一次公网校验；构造的 Response 没有 url。
    Object.defineProperty(response, 'url', { value: url, configurable: true });
    return response;
  });
}

async function withHost(fn, { shared } = {}) {
  const host = makePluginContext({ shared });
  try {
    const result = await fn(host);
    return result;
  } finally {
    for (const dispose of host.disposers.reverse()) await dispose();
  }
}

/* ───────────────────────── 1. 远端 registry 卡片 ───────────────────────── */

test('远端 registry 卡片（state.remoteConnectors）的 stdio server 连接前必须确认', async () => {
  const catalogUrl = 'https://catalog.example.com/catalog.json';
  const card = stdioCard('reg-stdio', [
    stdioServer('s1', { command: 'C:\\Windows\\System32\\cmd.exe', args: ['/c', 'echo', 'REMOTE_PWNED'] }),
  ]);
  const host = makePluginContext();
  // 预置远端目录缓存：loadCatalog 走缓存分支，其结果与真实 fetch 一样落进 state.remoteConnectors，
  // 且不依赖网络（本机带 HTTP(S)_PROXY，真实 fetch 会走代理）。
  await host.tables.get('catalog').put('remote', {
    key: 'remote', updatedAt: Date.now(), catalogUrl, connectors: [card],
  });
  try {
    await apply(host.ctx, baseConfig({ catalogUrl }));

    // 目录里确实能看到这张卡片（说明它来自远端来源，而不是 config.connectors）。
    const catalog = await execute(host, 'catalog', {});
    assert.ok(catalog.detail.items.some((item) => item.id === 'reg-stdio'), '远端卡片应进入目录');

    const blocked = await execute(host, 'connect', { connectorId: 'reg-stdio', serverKey: 's1' });
    assert.equal(blocked.ok, false, '未确认的远端 stdio 卡片不得连接：' + blocked.message);
    assert.equal(blocked.detail?.kind, 'stdio-confirmation-required');
    assert.equal(blocked.detail?.connectorId, 'reg-stdio');
    assert.equal(blocked.detail?.serverKey, 's1');
    assert.ok(blocked.detail?.fingerprint, '拦截结果必须带指纹，供 UI 展示');
    // 关键：确认墙必须挡在「挂载 Host 条目」之前。
    assert.equal(host.loader.entries.size, 0, '被拦下的卡片不得产生 loader 条目（否则等于已执行）');

    // 显式确认后才允许连接；确认状态与指纹必须落到连接记录里（重启后仍需有效）。
    const confirmed = await host.webCall('confirmStdioLaunch', { connectorId: 'reg-stdio', serverKey: 's1' });
    assert.equal(confirmed.ok, true, confirmed.message);
    assert.equal(confirmed.detail.fingerprint, blocked.detail.fingerprint);

    const connected = await execute(host, 'connect', { connectorId: 'reg-stdio', serverKey: 's1' });
    assert.equal(connected.ok, true, connected.message);
    const record = await host.tables.get('connections').get('reg-stdio-s1');
    assert.equal(record?.stdioLaunchConfirmed, true);
    assert.equal(record?.stdioLaunchFingerprint, blocked.detail.fingerprint);
  } finally {
    for (const dispose of host.disposers.reverse()) await dispose();
  }
});

/* ───────────────────────── 2. configure 分支 ───────────────────────── */

test('installFromUrl 后用 configure 直接挂载 stdio 也必须被确认墙拦住', async (t) => {
  const url = 'https://example.com/dyn-cred.json';
  const card = {
    id: 'dyn-cred',
    name: 'Dyn Cred',
    auth: { mode: 'bearer', credentialFields: [{ key: 'token', label: 'Token', required: true }] },
    servers: [
      { serverKey: 's1', serverName: 'dyn-http', transport: 'streamable-http', url: 'https://example.com/mcp' },
      {
        serverKey: 's2', serverName: 'dyn-stdio', transport: 'stdio',
        command: 'C:\\Windows\\System32\\cmd.exe', args: ['/c', 'echo', 'DYN_PWNED'],
        credentialBindings: { CARD_TOKEN: 'token' },
      },
    ],
  };
  mockCardFetch(t, { [url]: card });
  await withHost(async (host) => {
    await apply(host.ctx, baseConfig());
    const installed = await execute(host, 'install_from_url', { url });
    assert.equal(installed.ok, true, installed.message);
    assert.equal(installed.detail?.requiresManualConfirmation, true);
    assert.equal(installed.detail?.pendingConfirmationCount, 1);
    assert.equal(installed.detail.launchCommands[0].serverKey, 's2');
    assert.ok(installed.detail.launchCommands[0].fingerprint);

    // 不确认，直接 configure —— 这是 PoC5 的绕过链。
    const configured = await execute(host, 'configure', {
      connectorId: 'dyn-cred',
      credentialValues: { token: 'secret-token-value' },
    });
    assert.equal(configured.ok, false, 'configure 不得跳过 stdio 确认墙：' + configured.message);
    assert.equal(configured.detail?.kind, 'stdio-confirmation-required');
    // 凭据与命令都不得被挂载：loader 里不应出现任何条目。
    assert.equal(host.loader.entries.size, 0);
    assert.equal(await host.tables.get('connections').get('dyn-cred-s2'), undefined);
    assert.doesNotMatch(JSON.stringify(configured), /secret-token-value/);
  });
});

/* ───────────────────────── 3. localOverrides 使指纹失效 ───────────────────────── */

/**
 * 「确认 A、执行 B」的核心断言：确认之后再用 applyLocalOverrides 改 args/env，
 * 要么整体被拒绝（fail-closed），要么成功但立刻要求重新确认。
 * 两种实现都合规，**唯一不可接受**的是：覆盖生效、确认仍有效、且不提示重新确认。
 */
test('确认后 applyLocalOverrides 改 args/env 不得让「旧的确认」继续覆盖「新的命令」', async (t) => {
  const url = 'https://example.com/harmless.json';
  const card = stdioCard('dyn-ok', [stdioServer('s1', { command: 'node', args: ['server.js'], cwd: '', env: { FOO: 'bar' } })]);
  mockCardFetch(t, { [url]: card });
  const overrides = { argsAppend: ['--require=/tmp/evil.js'], env: { NODE_OPTIONS: '--require=/tmp/evil2.js' } };
  await withHost(async (host) => {
    await apply(host.ctx, baseConfig());
    const installed = await execute(host, 'install_from_url', { url });
    assert.equal(installed.ok, true, installed.message);
    const fingerprintBefore = installed.detail.launchCommands[0].fingerprint;

    assert.equal((await host.webCall('confirmStdioLaunch', { connectorId: 'dyn-ok', serverKey: 's1' })).ok, true);
    const connected = await execute(host, 'connect', { connectorId: 'dyn-ok', serverKey: 's1' });
    assert.equal(connected.ok, true, connected.message);
    const key = connected.detail.key;
    assert.equal(key, 'dyn-ok-s1');

    // 纯函数口径：覆盖进入指纹（否则「确认 A、执行 B」在指纹层就成立）。
    const server = card.servers[0];
    const fingerprintWithOverrides = stdioLaunchFingerprint(server, { localOverrides: overrides });
    assert.notEqual(fingerprintWithOverrides, fingerprintBefore);

    const overridden = await host.webCall('applyLocalOverrides', { key, json: JSON.stringify(overrides) });
    const entryConfig = host.loader.entries.get('mcp-dyn-ok-s1')?.options?.config;

    if (overridden.ok === false) {
      // 实现选择「覆盖后无法立即满足门禁 → 整体拒绝并回滚」：这同样是安全的（fail-closed），
      // 前提是它没有偷偷把新命令挂上去、也没有悄悄保留旧确认去执行新命令。
      assert.equal(entryConfig?.args?.[0], 'server.js');
      assert.ok(!(entryConfig?.args ?? []).includes(overrides.argsAppend[0]), '被拒绝的覆盖不得出现在实际启动命令里');
      assert.notEqual(entryConfig?.env?.NODE_OPTIONS, overrides.env.NODE_OPTIONS, '被拒绝的覆盖不得注入环境变量');
      const record = await host.tables.get('connections').get(key);
      assert.equal(record?.localOverrides, undefined, '被拒绝的覆盖不得落库');
      assert.equal(record?.stdioLaunchConfirmed, true, '原确认仍然对原命令有效');
      assert.equal(record?.stdioLaunchFingerprint, fingerprintBefore);
    } else {
      // 实现选择「接受覆盖并要求重新确认」：必须显式标记，且覆盖不得在未重新确认时被挂载。
      assert.equal(overridden.detail?.requiresStdioReconfirmation, true, '覆盖改变执行命令后必须要求重新确认');
      assert.match(overridden.message, /重新确认/);
      const blocked = await execute(host, 'connect', { connectorId: 'dyn-ok', serverKey: 's1' });
      assert.equal(blocked.ok, false, '覆盖后不重新确认不得连接：' + blocked.message);
      assert.ok(
        ['stdio-confirmation-required', 'stdio-confirmation-stale'].includes(blocked.detail?.kind),
        '应要求重新确认，实际 kind=' + blocked.detail?.kind,
      );
      // 重新确认（指纹按覆盖后的命令重算）后必须能恢复连接。
      const reconfirmed = await host.webCall('confirmStdioLaunch', { connectorId: 'dyn-ok', serverKey: 's1' });
      assert.equal(reconfirmed.ok, true, reconfirmed.message);
      assert.equal(reconfirmed.detail.fingerprint, fingerprintWithOverrides);
      const reconnected = await execute(host, 'connect', { connectorId: 'dyn-ok', serverKey: 's1' });
      assert.equal(reconnected.ok, true, reconnected.message);
    }

    // 无论走哪条分支，覆盖一旦生效就必须与实际执行命令一致：
    // 挂在 loader 上的命令若含覆盖内容，确认指纹必须也是覆盖后的指纹。
    const finalEntry = host.loader.entries.get('mcp-dyn-ok-s1')?.options?.config;
    const finalRecord = await host.tables.get('connections').get(key);
    const executedWithOverrides = (finalEntry?.args ?? []).includes(overrides.argsAppend[0])
      || finalEntry?.env?.NODE_OPTIONS === overrides.env.NODE_OPTIONS;
    if (executedWithOverrides) {
      assert.equal(finalRecord?.stdioLaunchFingerprint, fingerprintWithOverrides,
        '实际执行的是覆盖后的命令时，确认指纹必须是覆盖后的指纹');
    }
  });
});

/* ───────────────────────── 4. 多 stdio server 卡片逐条确认 ───────────────────────── */

test('多 stdio server 卡片必须逐条确认：未确认的那条 connect 仍被拦', async (t) => {
  const url = 'https://example.com/multi.json';
  const card = stdioCard('multi', [
    stdioServer('s1', { command: 'node', args: ['one.js'], serverName: 'multi-one' }),
    stdioServer('s2', { command: 'node', args: ['two.js'], serverName: 'multi-two' }),
  ]);
  mockCardFetch(t, { [url]: card });
  await withHost(async (host) => {
    await apply(host.ctx, baseConfig());
    const installed = await execute(host, 'install_from_url', { url });
    assert.equal(installed.ok, true, installed.message);
    assert.equal(installed.detail?.requiresManualConfirmation, true);
    assert.equal(installed.detail?.pendingConfirmationCount, 2, '每条 stdio server 都要单独确认');
    const launch = Object.fromEntries(installed.detail.launchCommands.map((item) => [item.serverKey, item]));
    assert.deepEqual(Object.keys(launch).sort(), ['s1', 's2']);
    assert.notEqual(launch.s1.fingerprint, launch.s2.fingerprint, '不同命令必须有不同指纹');

    // 只确认第一条。
    const confirmed = await host.webCall('confirmStdioLaunch', { connectorId: 'multi', serverKey: 's1' });
    assert.equal(confirmed.ok, true, confirmed.message);

    const first = await execute(host, 'connect', { connectorId: 'multi', serverKey: 's1' });
    assert.equal(first.ok, true, first.message);

    const second = await execute(host, 'connect', { connectorId: 'multi', serverKey: 's2' });
    assert.equal(second.ok, false, '未确认的 server 不得借第一条的确认通过：' + second.message);
    assert.equal(second.detail?.kind, 'stdio-confirmation-required');
    assert.equal(second.detail?.serverKey, 's2');
    assert.equal(host.loader.entries.has('mcp-multi-s2'), false, '未确认的 server 不得产生 loader 条目');

    // 补确认后可以连接。
    assert.equal((await host.webCall('confirmStdioLaunch', { connectorId: 'multi', serverKey: 's2' })).ok, true);
    const secondOk = await execute(host, 'connect', { connectorId: 'multi', serverKey: 's2' });
    assert.equal(secondOk.ok, true, secondOk.message);
  });
});

/* ───────────────────────── 5. 指纹直接单测 ───────────────────────── */

test('stdioLaunchFingerprint：command/args/cwd/env 值任一变更都会改变指纹', () => {
  const base = { serverKey: 's1', serverName: 'n', transport: 'stdio', command: 'node', args: ['server.js'], cwd: '/work', env: { A: '1', B: '2' } };
  const fp = stdioLaunchFingerprint(base);
  assert.match(fp, /^[0-9a-f]{32}$/);

  const variants = {
    command: { ...base, command: 'node.exe' },
    args: { ...base, args: ['server.js', '--inspect'] },
    argsOrder: { ...base, args: ['--inspect', 'server.js'] },
    cwd: { ...base, cwd: '/other' },
    envValue: { ...base, env: { A: '1', B: 'changed' } },
    envKey: { ...base, env: { A: '1', C: '2' } },
    envAdded: { ...base, env: { A: '1', B: '2', C: '3' } },
  };
  for (const [name, variant] of Object.entries(variants)) {
    assert.notEqual(stdioLaunchFingerprint(variant), fp, '变体 ' + name + ' 必须改变指纹（否则「确认 A、执行 B」成立）');
  }
  // 等价输入必须稳定（同一命令重复计算不能抖动）。
  assert.equal(stdioLaunchFingerprint({ ...base, args: ['server.js'] }), fp);
  // 缺省值归一：没有 cwd / env 与空字符串 / 空对象等价。
  assert.equal(
    stdioLaunchFingerprint({ command: 'node', args: [] }),
    stdioLaunchFingerprint({ command: 'node', args: [], cwd: '', env: {} }),
  );
});

test('stdioLaunchFingerprint：env 非字符串值不得碰撞（类型也要进指纹）', () => {
  const mk = (env) => stdioLaunchFingerprint({ command: 'node', args: [], env });
  // 对象：不同内容必须不同（String({}) 都是 "[object Object]"）。
  assert.notEqual(mk({ X: { a: 1 } }), mk({ X: { b: 2 } }));
  // 数字与同形字符串必须不同。
  assert.notEqual(mk({ X: 123 }), mk({ X: '123' }));
  // 数组与同形字符串/对象必须不同。
  assert.notEqual(mk({ X: ['a', 'b'] }), mk({ X: 'a,b' }));
  assert.notEqual(mk({ X: ['a'] }), mk({ X: { 0: 'a' } }));
  // 布尔与字符串必须不同。
  assert.notEqual(mk({ X: true }), mk({ X: 'true' }));
  // 嵌套数组元素类型敏感。
  assert.notEqual(mk({ X: [1, 2] }), mk({ X: ['1', '2'] }));
});

test('stdioLaunchFingerprint：localOverrides 进指纹（argsAppend/env/cwd 任一变更）', () => {
  const server = { command: 'node', args: ['server.js'], cwd: '', env: {} };
  const plain = stdioLaunchFingerprint(server);
  assert.notEqual(stdioLaunchFingerprint(server, { localOverrides: { argsAppend: ['--require=/tmp/evil.js'] } }), plain);
  assert.notEqual(stdioLaunchFingerprint(server, { localOverrides: { env: { NODE_OPTIONS: '--require=/tmp/evil.js' } } }), plain);
  assert.notEqual(stdioLaunchFingerprint(server, { localOverrides: { cwd: '/tmp' } }), plain);
  // 空覆盖与不传覆盖等价（确认时的口径必须稳定）。
  assert.equal(stdioLaunchFingerprint(server, { localOverrides: {} }), plain);
  assert.equal(stdioLaunchFingerprint(server, { localOverrides: { argsAppend: [], env: {}, cwd: '' } }), plain);
});

/* ───────────────────────── 6. describeLaunchEnv（确认框披露） ───────────────────────── */

test('describeLaunchEnv：危险加载器变量展示完整值，其余脱敏', () => {
  const env = {
    NODE_OPTIONS: '--require=/tmp/evil.js',
    LD_PRELOAD: '/tmp/evil.so',
    API_TOKEN: 'super-secret-value-123456',
    PLAIN: 'xyz',
  };
  const entries = Object.fromEntries(describeLaunchEnv(env).map((item) => [item.key, item]));
  assert.deepEqual(Object.keys(entries).sort(), ['API_TOKEN', 'LD_PRELOAD', 'NODE_OPTIONS', 'PLAIN']);
  // 决定「加载什么代码」的变量必须完整披露，否则就是盲签。
  assert.equal(entries.NODE_OPTIONS.dangerous, true);
  assert.equal(entries.NODE_OPTIONS.display, '--require=/tmp/evil.js');
  assert.equal(entries.LD_PRELOAD.dangerous, true);
  assert.equal(entries.LD_PRELOAD.display, '/tmp/evil.so');
  // 其余变量只脱敏展示，不得把凭据回显到界面。
  assert.equal(entries.API_TOKEN.dangerous, false);
  assert.ok(!entries.API_TOKEN.display.includes('super-secret-value-123456'));
  assert.equal(entries.API_TOKEN.length, 'super-secret-value-123456'.length);
});

/* ───────────────────────── 7. 反向保护：用户自建 stdio 不被误拦 ───────────────────────── */

test('config.connectors 里的用户自建 stdio 卡片不受确认墙限制（避免把自建连接全拦死）', async () => {
  const card = stdioCard('local-card', [stdioServer('s1', { command: 'node', args: ['local-server.js'] })]);
  await withHost(async (host) => {
    await apply(host.ctx, baseConfig({ connectors: [card] }));
    const connected = await execute(host, 'connect', { connectorId: 'local-card', serverKey: 's1' });
    assert.equal(connected.ok, true, connected.message);
    assert.ok(host.loader.entries.has('mcp-local-card-s1'));
  });
});
