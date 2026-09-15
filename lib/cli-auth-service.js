import { createCliAuthorizationManager } from './cli-providers.js';
import { createDwsAuthAdapters } from './cli-auth-runtime.js';

/** UI-only facade: config-owned runtime path, never supplied by HTTP callers. */
export function createCliAuthService({ packageDir = '', adaptersFactory = createDwsAuthAdapters } = {}) {
  let manager;
  let initializing;
  let disposed = false;
  let unavailable;
  async function ready() {
    if (disposed || !packageDir || unavailable) return false;
    if (!initializing) initializing = adaptersFactory(packageDir).then((adapters) => {
      if (!disposed) manager = createCliAuthorizationManager(adapters);
    }).catch(() => { unavailable = true; });
    await initializing;
    return !!manager && !disposed;
  }
  const response = () => ({ ok: true, detail: {
    available: !!manager && !disposed,
    ...(manager?.status() ?? { phase: 'unavailable', attemptId: null }),
    message: !packageDir ? '未配置可信 CLI 安装目录，请由本机维护者设置 dingtalkCliPackageDir 后重启；仍可使用官方终端登录。'
      : unavailable ? 'CLI 版本、路径或平台未通过验证，页面授权不可用；请检查本机配置。'
        : '企业未开放 CLI 时请等待管理员处理；页面授权不能绕过企业政策。',
  } });
  return {
    async status() { await ready(); return response(); },
    async start(params = {}) {
      if (params.confirmed !== true) return { ok: false, message: '请先确认发起官方浏览器授权' };
      if (!await ready()) return { ...response(), ok: false, message: response().detail.message };
      try { manager.start(); return response(); }
      catch { return { ok: false, message: '授权正在进行或清理中，请等待或取消当前任务' }; }
    },
    async cancel(params = {}) {
      manager?.cancel(params.attemptId);
      return response();
    },
    async dispose() { disposed = true; await initializing; await manager?.dispose(); },
  };
}
