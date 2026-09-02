/**
 * 连接健康摘要与可解释诊断。
 *
 * 诊断只描述插件实际观察到的状态。没有主动检查结果、或 Host 无法提供
 * stdio 注册状态时，一律返回 unknown，不把“已保存配置”冒充为“可用”。
 */

export const CONNECTION_STATE_LABELS = Object.freeze({
  disconnected: '未连接',
  unknown: '状态未知',
  configured: '已配置', // 仅兼容旧结果；新摘要不再产生该状态。
  disabled: '已停用',
  healthy: '已连接',
  degraded: '部分异常',
  reauth: '需重新授权',
  recovering: '自动重试中',
  unavailable: '连接异常',
});

const STAGE_LABELS = Object.freeze({
  configuration: '配置',
  authentication: '鉴权',
  transport: '网络与传输',
  'mcp-initialize': 'MCP 初始化',
  'host-startup': 'Host 启动',
  'host-observation': 'Host 状态观测',
  'tool-discovery': '工具发现',
  ready: '可用性确认',
});

const FAILURE_GUIDANCE = Object.freeze({
  auth: ['authentication', '重新授权或更新凭据，然后再次运行健康检查'],
  refresh: ['authentication', '等待自动重试；若持续失败，请检查网络和 OAuth 服务状态'],
  conflict: ['configuration', '停用冲突的旧插件或完成授权迁移后重试'],
  'rate-limit': ['transport', '等待服务端限流窗口结束后重试'],
  dns: ['transport', '检查 DNS、代理和当前网络后重试'],
  tls: ['transport', '检查证书、VPN/专线和来源 IP 白名单后重试'],
  refused: ['transport', '检查 MCP URL 和目标服务状态后重试'],
  timeout: ['transport', '检查网络、服务状态和超时设置后重试'],
  http: ['transport', '检查 MCP URL、服务状态和访问策略后重试'],
  network: ['transport', '检查网络和 MCP URL 后重试'],
  protocol: ['mcp-initialize', '确认 URL 指向兼容的 MCP Streamable HTTP 端点'],
  startup: ['host-startup', '检查 Host 日志、启动命令、参数和运行环境后重试'],
  'process-not-found': ['host-startup', '安装所需运行时或修正 stdio command 后重试'],
  'process-exit': ['host-startup', '检查进程退出码、参数、环境变量和 Host 日志'],
  'host-version': ['host-observation', '升级 DSH Host 后重新检查'],
  'host-tools-pending': ['host-observation', '查看 Host 日志并重新检查；可用性确认前保持未知'],
  'host-status-unavailable': ['host-observation', '升级或重启 DSH Host，待注册状态可见后重新检查'],
  'host-status-error': ['host-observation', '查看 Host 日志并重新检查工具注册状态'],
  'tool-list': ['tool-discovery', '检查 Server 工具权限和服务状态后重试'],
});

function resultId(result) {
  return result?.serverKey || result?.serverName || '';
}

function previousResult(previous, result) {
  const id = resultId(result);
  if (!id) return undefined;
  return previous?.results?.find((item) => resultId(item) === id);
}

function failureState(kind) {
  if (kind === 'auth') return 'reauth';
  if (kind === 'refresh') return 'recovering';
  return 'unavailable';
}

function resultDiagnostic(result, checkedAt, previous) {
  const earlier = previousResult(previous, result)?.diagnostic;
  if (result.ok && result.kind !== 'managed') {
    return {
      state: 'healthy',
      stage: result.stage || (result.kind === 'connected' ? 'ready' : 'tool-discovery'),
      stageLabel: STAGE_LABELS[result.stage || (result.kind === 'connected' ? 'ready' : 'tool-discovery')],
      code: result.code || 'ok',
      message: result.message || '最近一次可用性检查通过',
      action: '无需操作',
      checkedAt,
      lastSuccessfulAt: checkedAt,
    };
  }

  if (result.ok && result.kind === 'managed') {
    const code = result.code || 'host-status-unavailable';
    const [stage, action] = FAILURE_GUIDANCE[code] || FAILURE_GUIDANCE['host-status-unavailable'];
    return {
      state: 'unknown',
      stage,
      stageLabel: STAGE_LABELS[stage],
      code,
      message: result.message || '当前无法从 Host 确认 stdio Server 的工具注册状态',
      action,
      checkedAt,
      lastSuccessfulAt: earlier?.lastSuccessfulAt ?? null,
    };
  }

  const code = result.code || result.kind || 'network';
  const [stage, action] = FAILURE_GUIDANCE[code] || FAILURE_GUIDANCE.network;
  return {
    state: failureState(result.kind),
    stage,
    stageLabel: STAGE_LABELS[stage],
    code,
    message: result.message || '连接检查未通过',
    action,
    checkedAt,
    lastSuccessfulAt: earlier?.lastSuccessfulAt ?? null,
  };
}

function emptyDiagnostic(connectionState, checkedAt, previous) {
  const values = {
    disconnected: ['configuration', 'not-configured', '尚未保存连接', '连接或配置该连接器后再检查'],
    disabled: ['configuration', 'disabled', '连接已停用，未执行可用性检查', '启用连接后再运行健康检查'],
    unknown: ['host-observation', 'not-checked', '已保存配置，但本进程尚未观察到可用性检查结果', '运行健康检查以确认连接状态'],
  };
  const [stage, code, message, action] = values[connectionState] || values.unknown;
  return {
    state: connectionState,
    stage,
    stageLabel: STAGE_LABELS[stage],
    code,
    message,
    action,
    checkedAt,
    lastSuccessfulAt: previous?.lastSuccessfulAt ?? null,
  };
}

/**
 * @param {{ connectorId: string, records: object[], results: object[], checkedAt?: number|null, previous?: object|null }} input
 */
export function buildHealthSummary({ connectorId, records, results, checkedAt = Date.now(), previous = null }) {
  const enabledRecords = records.filter((record) => record.enabled !== false);
  const normalizedResults = results.map((result) => ({
    ...result,
    diagnostic: resultDiagnostic(result, checkedAt, previous),
  }));
  const availableServers = normalizedResults.filter((result) => result.ok && result.kind !== 'managed').length;
  const pendingServers = normalizedResults.filter((result) => result.ok && result.kind === 'managed').length;
  const failedServers = normalizedResults.filter((result) => !result.ok).length;
  const authFailures = normalizedResults.filter((result) => !result.ok && result.kind === 'auth').length;
  const refreshFailures = normalizedResults.filter((result) => !result.ok && result.kind === 'refresh').length;

  let connectionState = 'unknown';
  if (records.length === 0) connectionState = 'disconnected';
  else if (enabledRecords.length === 0) connectionState = 'disabled';
  else if (failedServers === 0 && pendingServers === 0 && availableServers > 0) connectionState = 'healthy';
  else if (availableServers > 0 && (failedServers > 0 || pendingServers > 0)) connectionState = 'degraded';
  else if (pendingServers > 0 && failedServers === 0) connectionState = 'unknown';
  else if (authFailures > 0) connectionState = 'reauth';
  else if (refreshFailures > 0) connectionState = 'recovering';
  else if (failedServers > 0) connectionState = 'unavailable';

  const lastSuccessfulAt = availableServers > 0 ? checkedAt : previous?.lastSuccessfulAt ?? null;
  let diagnostic;
  if (normalizedResults.length === 0) {
    diagnostic = emptyDiagnostic(connectionState, checkedAt, previous);
  } else if (connectionState === 'healthy') {
    diagnostic = { ...normalizedResults[0].diagnostic, state: 'healthy', lastSuccessfulAt };
  } else {
    const representative = normalizedResults.find((result) => !result.ok)
      || normalizedResults.find((result) => result.kind === 'managed')
      || normalizedResults[0];
    diagnostic = {
      ...representative.diagnostic,
      state: connectionState,
      lastSuccessfulAt,
    };
  }

  return {
    connectorId,
    connectionState,
    label: CONNECTION_STATE_LABELS[connectionState],
    configuredServers: records.length,
    enabledServers: enabledRecords.length,
    availableServers,
    pendingServers,
    failedServers,
    checkedAt,
    lastSuccessfulAt,
    diagnostic,
    results: normalizedResults,
  };
}

export function diagnosticForRecord(summary, result) {
  return result?.diagnostic ?? summary?.diagnostic ?? null;
}
