# stdio 传输支持 —— 设计文档 & 开发实现

> 目标：补齐 stdio（本地进程）传输方式，达到与 WorkBuddy / TraeWork / Qwen Code 三家大厂传输方式全覆盖。
> 结论：**低成本补齐**——`@deepseek-ai/dsh-mcp-client` 已原生支持 stdio，我们只需在 schema + provisioning 两层「开闸透传」。

> **实施状态（2026-08-23）**：本文方案已经落地。schema、手工配置、JSON 导入、provisioning、Registry Schema、目录安全审计、健康状态、详情提示和自动测试均已完成；下文保留实施前的代码位置与改动建议，作为架构决策记录。
>
> **就绪语义加固（2026-08-26）**：用户主动连接时显式启用 `failOnStartupError`，必须等待 Host 完成首次 `initialize + tools/list` 后才持久化；健康检查与详情页改读 Host 实际注册的 `mcp__<serverName>__*` 工具。启动失败、进程退出或超时不再提前显示“已连接”。依赖默认值仍为 `false`，下文对应代码仅作为依赖能力说明。
> 状态：已完成（v0.2.12）

---

## 一、背景与目标

### 1.1 现状缺口

当前 `dsh-mcp-connector` 的传输方式（`transport`）仅支持：

- `streamable-http`
- `sse`

而三家大厂（腾讯 WorkBuddy、字节 TraeWork、阿里 Qwen Code）**全部支持 stdio（本地进程）**：

| 传输方式 | WorkBuddy | TraeWork | Qwen Code | 我们 |
|---------|:--------:|:--------:|:--------:|:----:|
| stdio（本地进程） | ✅ | ✅ | ✅ | ❌ |
| HTTP / streamable-http | ❓ | ✅ | ✅ | ✅ |
| SSE | ❓ | ❓ | ✅ | ✅ |

**缺失 stdio 导致**：无法接入大量社区 stdio 型 MCP server（GitHub、filesystem、playwright、memory 等 npm/pip 包）。

### 1.2 补齐目标

- 新增 `stdio` 传输方式，支持 `command / args / env / cwd` 配置
- 补齐后传输方式 = `stdio` + `streamable-http`（SSE 兼容），与大厂三家对齐
- 顺带修复：`sse` 归一化到 `streamable-http`（详见 §5.2）

---

## 二、技术前提（已核实 ✅）

`@deepseek-ai/dsh-mcp-client`（版本 `0.1.1-rc.2`，本地路径 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-mcp-client`）**已原生支持 stdio**，证据如下。

### 2.1 `lib/types/index.d.ts` —— StdioConfig 字段齐全

```ts
export interface StdioConfig {
  transport: 'stdio';
  serverName: string;
  command: string;                  // ✅ 启动命令
  args: string[];                   // ✅ 参数列表
  env: Record<string, string>;      // ✅ 环境变量（自动清理敏感变量）
  cwd: string;                      // ✅ 工作目录
  toolCallTimeoutMs: number;
  failOnStartupError: boolean;
  reconnect?: ReconnectConfig;
}
export type Config = StdioConfig | StreamableHttpConfig;
```

### 2.2 `lib/index.js` 源码 —— createTransport 直接对接 SDK

```js
function createTransport(config) {
  switch (config.transport) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),   // scrubbed parent env + 用户 env
        cwd: config.cwd,
      });
    case "streamable-http":
      return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
  }
}
```

### 2.3 `lib/index.js` —— Config schema 默认值（关键）

```js
const Config = z.union([
  z.object({
    transport: 'stdio',
    serverName: ...,
    command: z.string().required(),          // 唯一必填
    args: z.array(String).default([]),       // 默认 []
    env: z.dict(String).default({}),         // 默认 {}
    cwd: z.string().default(""),             // 默认 ""（建议显式传）
    toolCallTimeoutMs: z.number().default(60000),
    failOnStartupError: z.boolean().default(false),
    reconnect: ...,
  }),
  z.object({
    transport: 'streamable-http',
    serverName: ...,
    url: ...,
    headers: z.dict(String).default({}),
    toolCallTimeoutMs: z.number().default(60000),
    failOnStartupError: z.boolean().default(false),
    reconnect: ...,
  }),
]);
```

### 2.4 结论

- stdio 分支：**只有 `command` 必填**，`args/env/cwd/toolCallTimeoutMs` 均有默认值
- 我们**无需**改 mcp-client、无需独立实现子进程管理、无需新依赖
- 只需在 schema + provisioning 两层「开闸透传」

---

## 三、现状分析（当前 transport 链路）

当前 stdio 被「主动跳过」的 5 个位置：

| 文件 | 位置 | 现状 |
|------|------|------|
| `lib/schema.js` | `serverRefSchema` L12 | `transport: z.enum(['streamable-http', 'sse'])`，`url` 必填 |
| `lib/schema.js` | `connectionRecordSchema` L89 | `transport: z.enum(['streamable-http', 'sse'])`，`url` 必填 |
| `lib/mcp-provision.js` | `buildEntryConfig` L27-35 | 只透传 `transport/serverName/url/headers`，无 command/args/env/cwd |
| `lib/connectors/manual-connector.js` | `buildManualRecord` L33 | transport 只有 `sse`/`streamable-http`，无 stdio |
| `lib/connectors/json-connector.js` | `normalizeJsonImport` L70-72、L101-103 | `if (cfg.command || cfg.args) { skipped.push('stdio 暂不支持') }` |

加上 registry schema 和 tools 工具定义：

| 文件 | 位置 | 现状 |
|------|------|------|
| `registry/schema/connector.schema.json` | `servers.items` | `transport: enum ['streamable-http', 'sse']`，`url` required |
| `lib/tools.js` | `mcp_connector_configure` L119 | `transport: enum ['streamable-http', 'sse']` |

---

## 四、设计决策

### 决策 1：transport 值归一化为两个值

**最终合法 transport 值只有 `stdio` 和 `streamable-http`**，与 `dsh-mcp-client` 完全对齐。

- `sse` 在 normalize 阶段归一化为 `streamable-http`（MCP 官方 SDK 的 streamable-http 客户端已向后兼容 SSE 端点）
- 现有 `catalog/catalog.json` 和 `registry/catalog.json` **均无 sse**（已核实 0 处），归一化无破坏性

### 决策 2：schema 从「url 必填」改为「url/command 二选一」

- `streamable-http` 型：`url` 必填，`command/args/env/cwd` 为空
- `stdio` 型：`command` 必填，`url` 可为空，`args/env/cwd` 可选

采用「宽松 schema + normalize 阶段显式校验」风格（与现有代码注释「宽松校验、显式报错」一致）。

### 决策 3：stdio 凭据使用声明式字段绑定，真实值仅在本机注入 `env`

- stdio 是本地进程，密钥最终仍通过环境变量传递（如 `GITHUB_TOKEN`、`OPENAI_API_KEY`）。
- 无凭据的 stdio 连接器使用 `auth.mode: "none"`；需要用户输入的卡片使用 `bearer` 或 `api-key`，并在 `auth.credentialFields` 声明一个或多个输入字段。
- `servers[].credentialBindings` 只保存“环境变量名 → 凭据字段 key”的映射；`servers[].env` 只能包含非敏感默认值。
- 用户输入存入本机 `ConnectionRecord.env` 并透传给 `dsh-mcp-client`，不回写目录，也不出现在 catalog/status/log 输出。
- Registry 探针只校验声明与命令形状，绝不执行本地 stdio 命令。

### 决策 4：mcp-provision 按 transport 分支透传

- stdio 分支：`{ transport, serverName, command, args, env, cwd, failOnStartupError }`
- streamable-http 分支：`{ transport, serverName, url, headers, failOnStartupError }`

---

## 五、开发改动清单（按依赖顺序）

> 改动顺序：先 schema（数据模型）→ 再 connectors（通道）→ 再 provisioning（透传）→ 再 tools/registry（工具与 schema）。

### 5.1 `lib/schema.js` —— 数据模型

#### 5.1.1 `serverRefSchema`（L8-14）

**改前**：
```js
export const serverRefSchema = z.object({
  serverKey: z.string().min(1),
  url: z.string().min(1),
  serverName: z.string().min(1),
  transport: z.enum(['streamable-http', 'sse']).optional(),
  headers: z.record(z.string()).optional(),
});
```

**改后**：
```js
export const serverRefSchema = z.object({
  serverKey: z.string().min(1),
  url: z.string().optional(),                    // 从 required 改 optional（stdio 型无 url）
  command: z.string().optional(),                // 新增：stdio 启动命令
  args: z.array(z.string()).optional(),          // 新增：stdio 参数列表
  env: z.record(z.string()).optional(),          // 新增：stdio 环境变量
  cwd: z.string().optional(),                    // 新增：stdio 工作目录
  serverName: z.string().min(1),
  transport: z.enum(['streamable-http', 'sse', 'stdio']).optional(),  // 加 'stdio'
  headers: z.record(z.string()).optional(),
});
```

#### 5.1.2 `connectionRecordSchema`（L83-106）

**改前**（关键字段）：
```js
transport: z.enum(['streamable-http', 'sse']),
url: z.string().min(1),
```

**改后**：
```js
transport: z.enum(['streamable-http', 'stdio']),   // 注意：sse 已归一化，不再出现
url: z.string().optional(),                          // stdio 型无 url
command: z.string().optional(),                      // 新增
args: z.array(z.string()).optional(),                // 新增
env: z.record(z.string()).optional(),                // 新增
cwd: z.string().optional(),                          // 新增
```

#### 5.1.3 `normalizeConnectorDescriptor`（L133-181）

在 `servers` 的 map 中（当前 L140-146）：
```js
const servers = c.servers.map((s) => ({
  serverKey: s.serverKey,
  url: s.url,
  serverName: s.serverName,
  transport: s.transport ?? 'streamable-http',
  headers: s.headers ?? {},
}));
```

**改后**（含 sse 归一化 + stdio/url 校验）：
```js
const servers = c.servers.map((s) => {
  // sse 归一化为 streamable-http（dsh-mcp-client 只认 stdio | streamable-http）
  const transport = (s.transport ?? 'streamable-http') === 'sse' ? 'streamable-http' : (s.transport ?? 'streamable-http');
  if (transport === 'stdio') {
    if (!s.command) throw new Error(`server "${s.serverKey}": transport=stdio 时 command 必填`);
    return {
      serverKey: s.serverKey,
      url: s.url ?? '',
      command: s.command,
      args: s.args ?? [],
      env: s.env ?? {},
      cwd: s.cwd ?? '',
      serverName: s.serverName,
      transport,
      headers: s.headers ?? {},
    };
  }
  if (!s.url) throw new Error(`server "${s.serverKey}": transport=${transport} 时 url 必填`);
  return {
    serverKey: s.serverKey,
    url: s.url,
    command: '',
    args: [],
    env: {},
    cwd: '',
    serverName: s.serverName,
    transport,
    headers: s.headers ?? {},
  };
});
```

#### 5.1.4 `normalizeConnectionRecord`（L184-191）

在 `parsed.data` 返回前，加 sse 归一化兜底（防御：任何来源的 sse 都归一到 streamable-http）：
```js
export function normalizeConnectionRecord(raw) {
  const parsed = connectionRecordSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid connection record: ${issues}`);
  }
  const data = parsed.data;
  if (data.transport === 'sse') data.transport = 'streamable-http';  // 归一化兜底
  return data;
}
```

---

### 5.2 `lib/mcp-provision.js` —— 透传层（核心）

`buildEntryConfig`（L27-35）**改后**：

```js
function buildEntryConfig(record, grants) {
  if (record.transport === 'stdio') {
    // stdio：本地进程，无 HTTP headers；鉴权信息在 env
    return {
      transport: 'stdio',
      serverName: record.serverName,
      command: record.command,
      args: record.args ?? [],
      env: record.env ?? {},
      cwd: record.cwd || process.cwd(),   // 显式给 cwd，避免 dsh-mcp-client 默认 "" 导致 spawn 问题
      failOnStartupError: false,
    };
  }
  // streamable-http（含原 sse，已归一化）
  return {
    transport: 'streamable-http',
    serverName: record.serverName,
    url: record.url,
    headers: authHeaders(record, grants),
    failOnStartupError: false,
  };
}
```

> 注意：`process` 需在文件顶部无额外引入（Node 全局）。若 `buildEntryConfig` 是纯函数依赖注入场景，可在 `provision()` 里把 cwd 传进来，避免隐式依赖 `process`。

---

### 5.3 `lib/connectors/manual-connector.js` —— 自定义配置通道

`buildManualRecord`（L28-63）**改后**，支持 stdio：

```js
export function buildManualRecord(params = {}) {
  const name = String(params.name ?? '').trim();
  if (!name) throw new Error('name 必填');
  const serverName = slugServerName(params.serverName ?? name);

  // sse 归一化；支持 stdio
  const rawTransport = params.transport ?? 'streamable-http';
  const transport = rawTransport === 'sse' ? 'streamable-http' : rawTransport;

  if (transport === 'stdio') {
    const command = String(params.command ?? '').trim();
    if (!command) throw new Error('transport=stdio 时 command 必填');
    const args = Array.isArray(params.args) ? params.args.map(String) : [];
    const env = parseHeadersJson(params.envJson);   // 复用 parseHeadersJson 解析 env JSON 对象
    const cwd = String(params.cwd ?? '').trim() || undefined;
    return {
      key: `custom-${serverName}`,
      connectorId: CUSTOM_CONNECTOR_ID,
      kind: 'manual',
      name,
      transport: 'stdio',
      serverName,
      command,
      args,
      env,
      cwd,
      headers: {},
      auth: undefined,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  // streamable-http 分支（原逻辑不变）
  const url = assertSafeUrl(params.url).toString();
  const headers = parseHeadersJson(params.headersJson);
  const authMode = params.authMode ?? 'none';
  let auth;
  if (authMode === 'bearer') {
    if (!params.bearerToken) throw new Error('authMode=bearer 时 bearerToken 必填');
    auth = { mode: 'bearer', bearerToken: String(params.bearerToken) };
  } else if (authMode === 'api-key') {
    const apiKeyHeader = assertSafeHeaderName(params.apiKeyHeader ?? 'X-Api-Key');
    if (params.apiKeyValue === undefined || params.apiKeyValue === '') throw new Error('authMode=api-key 时 apiKeyValue 必填');
    auth = { mode: 'api-key', apiKeyHeader, apiKeyValue: String(params.apiKeyValue) };
  } else if (authMode !== 'none') {
    throw new Error(`unsupported authMode: ${authMode}`);
  }

  return {
    key: `custom-${serverName}`,
    connectorId: CUSTOM_CONNECTOR_ID,
    kind: 'manual',
    name,
    transport: 'streamable-http',
    url,
    serverName,
    headers,
    auth,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
```

> 注意：`parseHeadersJson` 当前用于解析 headers JSON，可复用解析 env JSON（逻辑相同：JSON 对象 → 字符串值 map）。若语义上不想混用，可加一个 `parseStringMap(json)` 通用函数，`parseHeadersJson` 和 env 解析都调它。

---

### 5.4 `lib/connectors/json-connector.js` —— JSON 导入通道

`normalizeJsonImport` 去掉「stdio 跳过」逻辑，改为解析 stdio。

**改前**（L70-73 的 mcpServers 分支）：
```js
if (cfg.command || cfg.args) {
  skipped.push(`${name}(stdio 暂不支持)`);
  continue;
}
```

**改后**（mcpServers 分支，支持 stdio）：
```js
const rawTransport = cfg.transport ?? cfg.type ?? (cfg.command ? 'stdio' : 'streamable-http');
const transport = rawTransport === 'sse' ? 'streamable-http' : rawTransport;

if (transport === 'stdio') {
  if (!cfg.command) {
    skipped.push(`${name}(stdio 缺 command)`);
    continue;
  }
  records.push({
    key: `json-${slugServerName(cfg.serverName ?? name)}`,
    connectorId: JSON_CONNECTOR_ID,
    kind: 'json',
    name: cfg.name ?? name,
    transport: 'stdio',
    serverName: slugServerName(cfg.serverName ?? name),
    command: cfg.command,
    args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
    env: coerceHeaders(cfg.env ?? {}),   // env 用同样的字符串化 map
    cwd: cfg.cwd ?? '',
    headers: {},
    auth: undefined,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  continue;
}

// streamable-http 分支（原逻辑）
if (!cfg.url) {
  skipped.push(`${name}(缺 url)`);
  continue;
}
const { auth, headers } = extractAuth(cfg.headers ?? cfg.httpHeaders);
records.push({
  key: `json-${slugServerName(cfg.serverName ?? name)}`,
  connectorId: JSON_CONNECTOR_ID,
  kind: 'json',
  name: cfg.name ?? name,
  transport,   // 已归一化
  url: assertSafeUrl(cfg.url).toString(),
  serverName: slugServerName(cfg.serverName ?? name),
  headers,
  auth,
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
```

`connections` 数组分支（L96-128）同理改造：`item.command` 判定 stdio，`item.args/item.env/item.cwd` 透传。

---

### 5.5 `lib/index.js` —— connect 的 none 分支 + configure 传递

#### 5.5.1 `connect()` 的 `auth.mode === 'none'` 分支（L439-458）

当前构造 record 用 `server.url`。**改后**按 transport 分支：

```js
if (connector.auth.mode === 'none') {
  const server = connector.servers.find((item) => item.serverKey === serverKey) ?? connector.servers[0];
  const isStdio = server.transport === 'stdio';
  const record = {
    key: `${connector.id}-${server.serverKey}`,
    connectorId: connector.id,
    kind: 'manual',
    name: connector.name,
    serverKey: server.serverKey,
    transport: server.transport,
    url: isStdio ? '' : server.url,
    command: isStdio ? server.command : undefined,
    args: isStdio ? server.args : undefined,
    env: isStdio ? server.env : undefined,
    cwd: isStdio ? server.cwd : undefined,
    serverName: server.serverName,
    headers: server.headers,
    auth: undefined,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await upsertRecord(record);
  return { ok: true, message: `已连接 "${connector.name}"`, detail: { key: record.key } };
}
```

#### 5.5.2 `configure()` 方法（L470-518）

`configure` 内部调用 `buildManualRecord(params)`，改动后自动支持 stdio。**无需额外改 configure 主体**，但需确认：
- `buildManualRecord` 收到的 `params` 里含 `command/args/envJson/cwd`（来自 tools.js 的参数定义，见 §5.6）
- connectorId 分支（L473-511）里 `buildManualRecord` 的调用需传 `transport` 和 stdio 字段

---

### 5.6 `lib/tools.js` —— `mcp_connector_configure` 工具定义

L119 的 `transport` 枚举改后，加 stdio 字段：

```js
transport: { type: 'string', enum: ['streamable-http', 'stdio'], description: '传输方式，默认 streamable-http；stdio 用于本地进程' },
command: { type: 'string', description: 'transport=stdio 时的启动命令（如 npx）' },
args: { type: 'array', items: { type: 'string' }, description: 'transport=stdio 时的参数列表' },
envJson: { type: 'string', description: 'transport=stdio 时的环境变量（JSON 对象字符串，如 {"GITHUB_TOKEN":"xxx"}）' },
cwd: { type: 'string', description: 'transport=stdio 时的工作目录，默认当前目录' },
```

同时更新 `description` 和 `anyOf` 校验：
- 现有 `anyOf: [{ required: ['connectorId'] }, { required: ['name', 'url'] }]`
- 改后需要允许 stdio 分支：`{ required: ['name', 'transport'] }` 且 transport=stdio 时 command 必填（在 execute 阶段校验即可，tools 层不强约束）

---

### 5.7 `registry/schema/connector.schema.json` —— registry JSON Schema

`servers.items`（当前 L38-58 区域）**改后**：

```json
"servers": {
  "type": "array",
  "minItems": 1,
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["serverKey", "serverName"],
    "properties": {
      "serverKey": { "type": "string", "minLength": 1 },
      "url": { "type": "string" },
      "command": { "type": "string" },
      "args": { "type": "array", "items": { "type": "string" } },
      "env": { "type": "object", "additionalProperties": { "type": "string" } },
      "cwd": { "type": "string" },
      "serverName": { "type": "string", "minLength": 1 },
      "transport": { "enum": ["streamable-http", "stdio"] },
      "headers": { "type": "object", "additionalProperties": { "type": "string" } }
    },
    "allOf": [
      {
        "if": { "properties": { "transport": { "const": "stdio" } } },
        "then": { "required": ["command"] }
      },
      {
        "if": { "properties": { "transport": { "const": "streamable-http" } } },
        "then": { "required": ["url"] }
      }
    ]
  }
}
```

> 变更点：`url` 从 `required` 移除；`transport` 枚举加 `stdio`、去掉 `sse`；新增 `command/args/env/cwd`；加 `allOf` 条件校验。

---

### 5.8 `registry/connectors/example.sample.json` —— 示例补 stdio

在示例里加一个 stdio 型 server 注释/示例（供第三方厂商参考）：

```json
{
  "servers": [
    {
      "serverKey": "main",
      "url": "https://mcp.example.com/stream",
      "serverName": "vendor-service",
      "transport": "streamable-http"
    }
  ]
}
```

补充说明（README 或注释）：stdio 型示例：
```json
{
  "serverKey": "local",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_TOKEN": "占位，由用户填写" },
  "cwd": "",
  "serverName": "github",
  "transport": "stdio"
}
```

---

### 5.9 测试用例（`test/`）

新增/修改测试，覆盖：

1. **`schema.test.mjs`**：
   - stdio server 描述能 normalize，command 缺省时抛错
   - sse 归一化为 streamable-http
   - connectionRecord 的 sse 归一化兜底
2. **`plugin-flow.test.mjs`**：
   - stdio 型连接器 connect → 生成 stdio record → provision 透传 command/args/env/cwd
3. **`config.test.mjs`**：
   - configure 传 stdio 字段 → buildManualRecord 产出正确 record
4. **`mcp-validation.test.mjs`**：
   - stdio record 不触发 url 安全校验（stdio 无 url）

---

## 六、安全考虑

| 风险 | 缓解 |
|------|------|
| stdio `command` 可执行任意本地命令 | command 来自（a）维护者审核的 catalog，或（b）用户主动 configure，风险可控；DSH 运行时沙箱机制兜底 |
| `env` 里的密钥泄露到日志 | dsh-mcp-client 的 `buildChildEnv` 已用 `scrubbedParentEnv()` 清理敏感父环境变量；我们持久化 env 到 storage domain 与现有 headers 鉴权一致，无新增泄露面 |
| `cwd` 空字符串导致 spawn 异常 | provisioning 层显式 `record.cwd \|\| process.cwd()` |
| 目录夹带密钥 | `auditRawDescriptor` 拒绝真实凭据字段，`auditDescriptor` 拒绝 `env` 中的 token/secret/API Key/password 类变量；只允许 `credentialBindings` 引用已声明字段 |
| 凭据映射错误或未使用 | Schema 与目录审计检查字段 key、env 名、重复映射、未知引用及未被任何 HTTP/stdio Server 使用的必填字段 |

---

## 七、改动文件总览

| 文件 | 改动类型 | 工作量 |
|------|---------|-------|
| `lib/schema.js` | 数据模型：加 stdio 字段 + sse 归一化 | 中 |
| `lib/mcp-provision.js` | 透传层：buildEntryConfig 按 transport 分支 | 低 |
| `lib/connectors/manual-connector.js` | 通道：支持 stdio | 中 |
| `lib/connectors/json-connector.js` | 通道：去跳过，解析 stdio | 中 |
| `lib/index.js` | connect none 分支 + configure 传递 | 低 |
| `lib/tools.js` | configure 工具参数 | 低 |
| `lib/catalog.js` | env 密钥审计（可选但建议） | 低 |
| `registry/schema/connector.schema.json` | JSON Schema 同步 | 低 |
| `registry/connectors/example.sample.json` | 示例补 stdio | 低 |
| `test/*.mjs` | 测试用例 | 中 |

**总工作量估算：1-2 个开发日。**

---

## 八、验收标准

1. **功能**：
   - catalog 里配置一个 stdio 型连接器 → 市场可见 → connect 成功 → 工具按 `mcp__<serverName>__*` 注册
   - configure 表单填 stdio（command/args/env）→ 连接成功
   - JSON 导入 `{ "mcpServers": { "gh": { "command": "npx", "args": [...] } } }` → 不再提示「stdio 暂不支持」，而是成功导入
2. **归一化**：
   - 任何来源的 `transport: 'sse'` 均被归一化为 `streamable-http`，provision 透传值不含 `sse`
3. **回归**：
   - 现有 streamable-http 连接器（企查查/北大法宝/Wind 等）连接、工具发现、鉴权不受影响
   - `npm run check`（lint + test + verify-pack）全绿
4. **安全**：
   - 目录里 stdio 连接器的 `env` 含 token/secret 字段时被 `auditRawDescriptor` 拦截
   - 多字段 `credentialFields` / `credentialBindings` 通过校验，未知引用与缺失必填值被拒绝
   - 真实值只进入本机连接记录与 Host env，catalog/status/log 均不返回

---

## 九、参考证据（已核实）

- `@deepseek-ai/dsh-mcp-client@0.1.1-rc.2`
  - `lib/types/index.d.ts`：`StdioConfig` / `StreamableHttpConfig` / `Config = StdioConfig | StreamableHttpConfig`
  - `lib/index.js`：`createTransport()` 分支 `StdioClientTransport` / `StreamableHTTPClientTransport`
  - `lib/index.js`：Config schema `command` 必填、`args/env/cwd/toolCallTimeoutMs` 有默认值
  - `lib/index.js` L14：`import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"`
- 三家大厂传输方式（官方文档）：
  - WorkBuddy：`mcp.json` 的 `command/args/env`（stdio）
  - TraeWork：`npx/uvx`（stdio）+ `url/headers`（HTTP）
  - Qwen Code：`stdio` / `http` / `sse` + OAuth

---

**文档版本**：v1.0
**生成时间**：2026-08-23
**设计基线版本**：v0.2.1

**实施版本规划**：v0.3.0
