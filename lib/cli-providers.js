import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_LOCALE, createTranslator } from './i18n/index.js';

/** 缺省译文：中文（既有调用点与测试无需改动）。 */
const tZh = createTranslator(DEFAULT_LOCALE);

const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const WRITE_VERBS = new Set([
  'add', 'approve', 'create', 'delete', 'disable', 'done', 'enable', 'insert',
  'invite', 'move', 'recall', 'reject', 'remove', 'rename', 'reply', 'revoke',
  'send', 'switch', 'update', 'upload',
]);

/**
 * 工具与参数描述 msgid（面向模型，最高价值的文案）。
 *
 * 建表发生在模块加载期，此时拿不到运行时语言，因此这里只存 **msgid（中文原文）**；
 * 真正的 `t()` 解析发生在 `listCliProviderTools()` / `inputSchema()` —— 它们按请求调用，
 * 可以拿到调用方传入的 `t`。缺省仍是中文 translator，既有调用点行为不变。
 */
const CLI_MSGIDS = Object.freeze({
  providerName: '钉钉工作台 CLI',

  toolGetCurrentUser: '读取当前钉钉 OAuth 身份的用户、组织和部门信息。',
  toolSearchUsers: '按关键词只读搜索钉钉企业通讯录。多人同名时应展示候选，不得自动选择。',
  toolGetUsers: '按一个或多个 userId 批量读取钉钉用户资料。',
  toolListCalendarEvents: '只读列出当前用户在指定时间范围内的钉钉日程；不传时间时由 dws 使用默认范围。',
  toolGetCalendarEvent: '按日程 ID 只读获取钉钉日程详情。',
  toolListTodos: '只读列出当前用户的钉钉待办。',
  toolGetTodo: '按待办 ID 只读获取钉钉待办详情。',
  toolSearchDocuments: '只读搜索当前用户有权访问的钉钉文件和文档。',
  toolListPendingApprovals: '只读列出指定时间范围内当前用户待处理的钉钉 OA 审批实例；不会执行同意或拒绝。',
  toolListReports: '只读列出指定时间范围内当前用户收到的钉钉日志。',
  toolListReportTemplates: '只读列出当前用户可用的钉钉日志模板。',

  fieldProfile: '可选的钉钉账号 profile（建议使用 corpId:userId）。不填写时使用 dws 当前 profile。',
  fieldContactQuery: '姓名、职位或通讯录关键词。',
  fieldIds: '钉钉 userId 列表。',
  fieldStart: 'ISO 8601 开始时间。',
  fieldEnd: 'ISO 8601 结束时间。',
  fieldEventId: '日程 ID。',
  fieldPage: '页码。',
  fieldPageSize: '每页数量。',
  fieldCompleted: 'true 仅已完成，false 仅未完成；不传则不过滤。',
  fieldTaskId: '待办任务 ID。',
  fieldDocumentQuery: '文件或文档标题、内容关键词。',
  fieldCursor: '分页游标。',
  fieldResultCount: '返回数量。',
});

function stringField(flag, options = {}) {
  return { flag, type: 'string', ...options };
}

function integerField(flag, options = {}) {
  return { flag, type: 'integer', ...options };
}

function booleanField(flag, options = {}) {
  return { flag, type: 'boolean', ...options };
}

function stringArrayField(flag, options = {}) {
  return { flag, type: 'string-array', ...options };
}

const profileField = stringField('--profile', {
  global: true,
  description: CLI_MSGIDS.fieldProfile,
});

/** `description` 存 msgid，由调用方在渲染时用 `t()` 解析。 */
function readTool(name, description, command, fields = {}) {
  return { name, description, command, fields, readOnly: true };
}

const dingtalkDwsTools = [
  readTool(
    'dingtalk_get_current_user',
    CLI_MSGIDS.toolGetCurrentUser,
    ['contact', 'user', 'get-self'],
    { profile: profileField },
  ),
  readTool(
    'dingtalk_search_users',
    CLI_MSGIDS.toolSearchUsers,
    ['contact', 'user', 'search'],
    {
      profile: profileField,
      query: stringField('--query', { required: true, description: CLI_MSGIDS.fieldContactQuery }),
    },
  ),
  readTool(
    'dingtalk_get_users',
    CLI_MSGIDS.toolGetUsers,
    ['contact', 'user', 'get'],
    {
      profile: profileField,
      ids: stringArrayField('--ids', { required: true, description: CLI_MSGIDS.fieldIds }),
    },
  ),
  readTool(
    'dingtalk_list_calendar_events',
    CLI_MSGIDS.toolListCalendarEvents,
    ['calendar', 'event', 'list'],
    {
      profile: profileField,
      start: stringField('--start', { description: CLI_MSGIDS.fieldStart }),
      end: stringField('--end', { description: CLI_MSGIDS.fieldEnd }),
    },
  ),
  readTool(
    'dingtalk_get_calendar_event',
    CLI_MSGIDS.toolGetCalendarEvent,
    ['calendar', 'event', 'get'],
    {
      profile: profileField,
      id: stringField('--id', { required: true, description: CLI_MSGIDS.fieldEventId }),
    },
  ),
  readTool(
    'dingtalk_list_todos',
    CLI_MSGIDS.toolListTodos,
    ['todo', 'task', 'list'],
    {
      profile: profileField,
      page: integerField('--page', { minimum: 1, maximum: 10000, description: CLI_MSGIDS.fieldPage }),
      size: integerField('--size', { minimum: 1, maximum: 100, description: CLI_MSGIDS.fieldPageSize }),
      completed: booleanField('--status', { description: CLI_MSGIDS.fieldCompleted }),
    },
  ),
  readTool(
    'dingtalk_get_todo',
    CLI_MSGIDS.toolGetTodo,
    ['todo', 'task', 'get'],
    {
      profile: profileField,
      taskId: stringField('--task-id', { required: true, description: CLI_MSGIDS.fieldTaskId }),
    },
  ),
  readTool(
    'dingtalk_search_documents',
    CLI_MSGIDS.toolSearchDocuments,
    ['drive', 'search'],
    {
      profile: profileField,
      query: stringField('--query', { required: true, description: CLI_MSGIDS.fieldDocumentQuery }),
    },
  ),
  readTool(
    'dingtalk_list_pending_approvals',
    CLI_MSGIDS.toolListPendingApprovals,
    ['oa', 'approval', 'list-pending'],
    {
      profile: profileField,
      start: stringField('--start', { required: true, description: CLI_MSGIDS.fieldStart }),
      end: stringField('--end', { required: true, description: CLI_MSGIDS.fieldEnd }),
      page: integerField('--page', { minimum: 1, maximum: 10000, description: CLI_MSGIDS.fieldPage }),
      limit: integerField('--limit', { minimum: 1, maximum: 100, description: CLI_MSGIDS.fieldPageSize }),
    },
  ),
  readTool(
    'dingtalk_list_reports',
    CLI_MSGIDS.toolListReports,
    ['report', 'inbox', 'list'],
    {
      profile: profileField,
      start: stringField('--start', { required: true, description: CLI_MSGIDS.fieldStart }),
      end: stringField('--end', { required: true, description: CLI_MSGIDS.fieldEnd }),
      cursor: integerField('--cursor', { minimum: 0, description: CLI_MSGIDS.fieldCursor }),
      size: integerField('--size', { minimum: 1, maximum: 20, description: CLI_MSGIDS.fieldResultCount }),
    },
  ),
  readTool(
    'dingtalk_list_report_templates',
    CLI_MSGIDS.toolListReportTemplates,
    ['report', 'template', 'list'],
    { profile: profileField },
  ),
];

export const CLI_PROVIDERS = Object.freeze({
  'dingtalk-dws': Object.freeze({
    id: 'dingtalk-dws',
    name: CLI_MSGIDS.providerName,
    executable: 'dws',
    homepage: 'https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli',
    preflight: Object.freeze(['auth', 'status']),
    tools: Object.freeze(dingtalkDwsTools),
  }),
});

function inputSchema(tool, { t = tZh } = {}) {
  const properties = {};
  const required = [];
  for (const [name, field] of Object.entries(tool.fields)) {
    const schema = { description: field.description === undefined ? undefined : t(field.description) };
    if (field.type === 'integer') {
      schema.type = 'integer';
      if (field.minimum !== undefined) schema.minimum = field.minimum;
      if (field.maximum !== undefined) schema.maximum = field.maximum;
    } else if (field.type === 'boolean') {
      schema.type = 'boolean';
    } else if (field.type === 'string-array') {
      schema.type = 'array';
      schema.items = { type: 'string', minLength: 1 };
      schema.minItems = 1;
      schema.maxItems = 100;
    } else {
      schema.type = 'string';
      schema.minLength = 1;
    }
    properties[name] = schema;
    if (field.required) required.push(name);
  }
  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length ? { required } : {}),
  };
}

export function listCliProviderTools(providerId, { t = tZh } = {}) {
  const provider = CLI_PROVIDERS[providerId];
  if (!provider) throw new Error(`unknown CLI provider: ${providerId}`);
  return provider.tools.map((tool) => ({
    name: tool.name,
    description: t(tool.description),
    inputSchema: inputSchema(tool, { t }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }));
}

function assertSafeExecutable(executable) {
  const value = String(executable ?? '').trim();
  if (!value || /[\0\r\n]/.test(value) || (/\s/.test(value) && !path.isAbsolute(value) && !path.win32.isAbsolute(value))) {
    throw new Error('CLI executable must be one command name or an absolute path');
  }
  return value;
}

function validateField(name, value, field) {
  if (value === undefined || value === null || value === '') {
    if (field.required) throw new Error(`missing required argument: ${name}`);
    return undefined;
  }
  if (field.type === 'string') {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
    if (/[\0\r\n]/.test(value)) throw new Error(`${name} contains forbidden control characters`);
    return value;
  }
  if (field.type === 'integer') {
    if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
    if (field.minimum !== undefined && value < field.minimum) throw new Error(`${name} must be >= ${field.minimum}`);
    if (field.maximum !== undefined && value > field.maximum) throw new Error(`${name} must be <= ${field.maximum}`);
    return String(value);
  }
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
    return String(value);
  }
  if (field.type === 'string-array') {
    if (!Array.isArray(value) || !value.length || value.length > 100) {
      throw new Error(`${name} must be an array containing 1-100 strings`);
    }
    const values = value.map((item) => {
      if (typeof item !== 'string' || !item.trim() || /[\0\r\n,]/.test(item)) {
        throw new Error(`${name} contains an invalid item`);
      }
      return item;
    });
    return values.join(',');
  }
  throw new Error(`unsupported field type for ${name}`);
}

export function buildCliInvocation(providerId, toolName, input = {}, options = {}) {
  const provider = CLI_PROVIDERS[providerId];
  if (!provider) throw new Error(`unknown CLI provider: ${providerId}`);
  const tool = provider.tools.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`unknown tool for ${providerId}: ${toolName}`);
  if (!tool.readOnly || tool.command.some((part) => WRITE_VERBS.has(part))) {
    throw new Error(`CLI provider tool is not approved for read-only execution: ${toolName}`);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('tool arguments must be an object');
  }
  const unknown = Object.keys(input).filter((key) => !Object.hasOwn(tool.fields, key));
  if (unknown.length) throw new Error(`unknown tool arguments: ${unknown.join(', ')}`);

  const globalArgs = [];
  const commandArgs = [];
  for (const [name, field] of Object.entries(tool.fields)) {
    const value = validateField(name, input[name], field);
    if (value === undefined) continue;
    const target = field.global ? globalArgs : commandArgs;
    target.push(field.flag, value);
  }
  return {
    command: assertSafeExecutable(options.executable ?? process.env.DSH_MCP_DINGTALK_DWS_BIN ?? provider.executable),
    args: [...globalArgs, ...tool.command, ...commandArgs, '--format', 'json'],
    provider,
    tool,
  };
}

export function buildCliPreflightInvocation(providerId, options = {}) {
  const provider = CLI_PROVIDERS[providerId];
  if (!provider) throw new Error(`unknown CLI provider: ${providerId}`);
  if (!Array.isArray(provider.preflight) || !provider.preflight.length) return null;
  if (provider.preflight.some((part) => WRITE_VERBS.has(part))) {
    throw new Error(`CLI provider preflight is not approved for read-only execution: ${providerId}`);
  }
  return {
    command: assertSafeExecutable(options.executable ?? process.env.DSH_MCP_DINGTALK_DWS_BIN ?? provider.executable),
    args: [...provider.preflight, '--format', 'json'],
  };
}

export function redactCliError(value) {
  return String(value ?? '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:(?:access|refresh)[_-]?token|client[_-]?secret|app[_-]?secret)["']?\s*[=:]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .trim();
}

// Resolve only the known provider package; never interpret or execute a shell shim.
export function resolveCliExecutable(command, options = {}) {
  const t = options.t ?? tZh;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== 'win32') return command;
  if (/\.(cmd|bat|ps1)$/i.test(command)) throw new Error(`[CLI_SHIM_UNSUPPORTED] ${t('请指定原生 exe，而非 shell 启动脚本')}`);
  if (command !== 'dws') return command; // Explicit override stays authoritative.
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  let sawShim = false;
  for (const raw of pathValue.split(';')) {
    const dir = raw.replace(/^"(.*)"$/, '$1');
    if (!path.isAbsolute(dir)) continue; // Never search cwd or relative PATH entries.
    const native = path.join(dir, 'dws.exe');
    if (existsSync(native) && statSync(native).isFile()) return native;
    if (existsSync(path.join(dir, 'dws.cmd'))) sawShim = true;
    const roots = path.basename(dir).toLowerCase() === '.bin'
      ? [path.join(dir, '..', 'dingtalk-workspace-cli')]
      : [path.join(dir, 'node_modules', 'dingtalk-workspace-cli')];
    for (const root of roots) {
      if (!existsSync(path.join(root, 'package.json'))) continue;
      try {
        const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
        // npm tarballs preserve "./", while registry metadata can omit it.
        // Accept only these two canonical entries; do not normalize traversal.
        if (pkg.name !== 'dingtalk-workspace-cli' || !['bin/dws.js', './bin/dws.js'].includes(pkg.bin?.dws)) continue;
        const realRoot = realpathSync(root);
        const binary = realpathSync(path.join(root, 'vendor', 'dws.exe'));
        const relative = path.relative(realRoot, binary);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !statSync(binary).isFile()) continue;
        return binary;
      } catch { /* Missing/corrupt packages must fail closed, not launch a shim. */ }
    }
  }
  throw new Error(sawShim
    ? `[CLI_NATIVE_MISSING] ${t('已发现 dws npm 启动脚本，但未找到有效的官方原生程序；请检查 CLI 安装，或通过 DSH_MCP_DINGTALK_DWS_BIN 指定 dws.exe')}`
    : `[CLI_NOT_FOUND] ${t('DSH 进程 PATH 中未找到 dws 原生程序或官方 npm 包；请检查安装与 DSH 环境后重启，不代表 OAuth 未登录')}`);
}

export function runCliProcess(command, args, options = {}) {
  const t = options.t ?? tZh;
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = Number.isInteger(options.maxOutputBytes) ? options.maxOutputBytes : MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    const executable = resolveCliExecutable(command, options);
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      fail(new Error(`CLI command timed out after ${timeoutMs}ms`));
    }, Math.max(1000, Math.min(timeoutMs, 300_000)));

    child.once('error', (error) => {
      if (error?.code === 'ENOENT') {
        fail(new Error(t('未找到官方 CLI 命令“{command}”；请先完成安装和 OAuth 登录，再重启 DSH', { command })));
        return;
      }
      fail(error);
    });
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        child.kill('SIGTERM');
        fail(new Error(`CLI stdout exceeded ${maxOutputBytes} bytes`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxOutputBytes) stderr.push(chunk);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString('utf8').trim();
      const errorOutput = redactCliError(Buffer.concat(stderr).toString('utf8'));
      if (code !== 0) {
        const hint = {
          2: t('身份认证或授权失败；请运行 dws auth login，并确认企业管理员已开启 CLI 访问'),
          3: t('参数未通过当前固定 dws 版本校验；请核对工具参数或升级 MCP 连接器目录'),
          4: t('钉钉要求补充权限授权；请按官方授权提示完成后重试'),
          6: t('dws 命令或服务发现失败；请检查网络、登录状态与 MCP 连接器目录版本'),
        }[code] ?? '';
        const details = [hint, errorOutput, signal ? `signal=${signal}` : ''].filter(Boolean).join('；');
        reject(new Error(`CLI command failed with exit code ${code}${details ? `: ${details}` : ''}`));
        return;
      }
      resolve(output);
    });
  });
}

export async function executeCliProviderTool(providerId, toolName, input = {}, options = {}) {
  const invocation = buildCliInvocation(providerId, toolName, input, options);
  const runner = options.runner ?? runCliProcess;
  const output = await runner(invocation.command, invocation.args, options);
  let normalized = redactCliError(output || '{"ok":true}');
  try {
    normalized = JSON.stringify(JSON.parse(normalized), null, 2);
  } catch {
    // Keep non-JSON success output readable; dws normally emits JSON with --format json.
  }
  return {
    content: [{ type: 'text', text: normalized }],
    isError: false,
  };
}

export async function ensureCliProviderReady(providerId, options = {}) {
  const t = options.t ?? tZh;
  const invocation = buildCliPreflightInvocation(providerId, options);
  if (!invocation) return;
  const runner = options.runner ?? runCliProcess;
  const output = await runner(invocation.command, invocation.args, options);
  // Exit code 0 / success:true means the status query succeeded, not that
  // the user is authenticated. Never expose the raw status (identity/tokens).
  let status;
  try {
    status = JSON.parse(output);
  } catch {
    throw new Error(`[CLI_AUTH_STATUS_INVALID] ${t('无法验证钉钉 OAuth 状态：官方 CLI 未返回有效 JSON；请检查 CLI 版本后重试')}`);
  }
  if (status?.success === true && status?.authenticated === false) {
    throw new Error(`[CLI_AUTH_REQUIRED] ${t('钉钉待授权：官方 CLI 当前未登录。具备企业授权条件后，在运行 DSH 的同一系统用户终端执行 npx -y dingtalk-workspace-cli@1.0.61 auth login。若已确认企业未开放 CLI，请等待管理员处理，无需反复登录、重启或填写 API Key；仅凭未登录状态不能判断管理员是否限制')}`);
  }
  if (!status || typeof status !== 'object' || Array.isArray(status)
    || status.success !== true || status.authenticated !== true) {
    throw new Error(`[CLI_AUTH_STATUS_INVALID] ${t('无法确认钉钉授权状态：官方 CLI 返回失败或不完整的状态响应；请核对 CLI 诊断。不能据此判断为未登录或管理员限制')}`);
  }
}

// Upgrade only the exact managed legacy invocation; preserve custom commands,
// environment, cwd and credentials. Applied on every provision, including restore.
export function cliBridgeArgs(record) {
  const legacy = ['--yes', '--legacy-peer-deps', '--package', argsVersion(record),
    '--package', 'dingtalk-workspace-cli@1.0.61', 'dsh-mcp-cli-bridge', '--provider', 'dingtalk-dws'];
  const args = record.args ?? [];
  if (!legacy[3] || record.connectorId !== 'dingtalk' || record.command !== 'npx'
    || JSON.stringify(args) !== JSON.stringify(legacy)) return args;
  return args.map((arg) => arg === legacy[3] ? 'dsh-mcp-connector@0.2.71' : arg);
}

function argsVersion(record) {
  const value = record.args?.[3];
  return ['dsh-mcp-connector@0.2.48', 'dsh-mcp-connector@0.2.49', 'dsh-mcp-connector@0.2.55'].includes(value) ? value : null;
}

export async function handleCliBridgeRequest(message, options = {}) {
  const t = options.t ?? tZh;
  const providerId = options.providerId ?? 'dingtalk-dws';
  if (!message || typeof message !== 'object') throw new Error('invalid JSON-RPC message');
  if (!Object.hasOwn(message, 'id')) return null;
  const base = { jsonrpc: '2.0', id: message.id };
  try {
    if (message.method === 'initialize') {
      return {
        ...base,
        result: {
          protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: `dsh-mcp-cli-bridge/${providerId}`, version: '1.0.0' },
        },
      };
    }
    if (message.method === 'ping') return { ...base, result: {} };
    if (message.method === 'tools/list') {
      try {
        const preflight = options.preflight ?? ensureCliProviderReady;
        await preflight(providerId, options);
      } catch (error) {
        return {
          ...base,
          error: {
            code: -32001,
            message: t('CLI Provider 未就绪：{error}', { error: redactCliError(error?.message ?? error) }),
          },
        };
      }
      return { ...base, result: { tools: listCliProviderTools(providerId, { t }) } };
    }
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      try {
        const execute = options.execute ?? executeCliProviderTool;
        return { ...base, result: await execute(providerId, name, args, options) };
      } catch (error) {
        return {
          ...base,
          result: {
            content: [{ type: 'text', text: redactCliError(error?.message ?? error) }],
            isError: true,
          },
        };
      }
    }
    return { ...base, error: { code: -32601, message: `Method not found: ${message.method}` } };
  } catch (error) {
    return { ...base, error: { code: -32603, message: redactCliError(error?.message ?? error) } };
  }
}
