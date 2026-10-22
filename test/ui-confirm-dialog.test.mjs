import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 回归守护：issue #136 —— 原生 confirm/alert/prompt 在桌面壳（Electron）里会走
// Win32 TaskDialog，关闭后 Electron 不把键盘焦点还给渲染进程，于是 document.hasFocus()
// 持续 false、输入框点不中也打不了字，必须切一次窗口才能恢复。上游 electron#41602
// 已 not_planned 关闭、修复 PR 未合并，所以插件侧必须自己保证：
//   ① 全仓不再出现原生阻塞弹窗调用；
//   ② 自绘确认框真的返回 Promise 并正确 resolve（否则 await 的调用点会永远挂起）；
//   ③ 每个 await 调用点都在 async 函数里（否则整段脚本语法都过不了）。
//
// ② 不做行为验证就不算验证过，所以下面的对话框测试直接执行 ui/index.html 里出货的
// 那段实现，只给它真正用到的 DOM 替身（与本仓 client.test.mjs 的手写替身同一路数，
// 不引入 jsdom 之类的测试依赖）。
const normalizeLineEndings = (source) => source.replace(/\r\n?/g, '\n');

const uiSource = normalizeLineEndings(await readFile(new URL('../ui/index.html', import.meta.url), 'utf8'));
const clientSource = normalizeLineEndings(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'));

/** 内联 <script> 正文。 */
function inlineScript() {
  const start = uiSource.indexOf('<script>');
  assert.notEqual(start, -1, 'ui/index.html 必须仍含内联 <script>');
  const bodyStart = start + '<script>'.length;
  const end = uiSource.indexOf('</script>', bodyStart);
  assert.notEqual(end, -1, '内联 <script> 必须闭合');
  return uiSource.slice(bodyStart, end);
}

/** 去掉注释，避免文档正文里提到 confirm( 被当成调用点。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"\\])\/\/.*$/, '$1'))
    .join('\n');
}

const scriptBody = inlineScript();
const scriptCode = stripComments(scriptBody);

test('ui/index.html 内联脚本不再出现原生 confirm/alert/prompt 调用', () => {
  const hits = [];
  for (const name of ['alert', 'prompt']) {
    for (const match of scriptCode.matchAll(new RegExp(`(?:window\\.)?${name}\\s*\\(`, 'g'))) {
      hits.push(`${match[0].trim()} @ offset ${match.index}`);
    }
  }
  for (const match of scriptCode.matchAll(/(?:window\.)?confirm\s*\(/g)) {
    if (scriptCode.startsWith('confirmDialog', match.index)) continue;
    hits.push(`${match[0].trim()} @ offset ${match.index}`);
  }
  assert.deepEqual(hits, [], `原生弹窗会让桌面壳丢失键盘焦点，必须清空：${hits.join(', ')}`);
});

test('lib/client.js 不再出现原生 confirm/alert/prompt 调用', () => {
  const code = stripComments(clientSource);
  assert.doesNotMatch(code, /window\.prompt/);
  assert.doesNotMatch(code, /(?:window\.)?confirm\s*\(/);
  assert.doesNotMatch(code, /window\.alert/);
});

test('11 处确认均使用 await confirmDialog，且脚本仍可解析（async 上下文正确）', () => {
  const sites = [...scriptCode.matchAll(/await confirmDialog\(/g)];
  assert.equal(sites.length, 11, '原有 10 处确认加本地覆盖重置确认均使用内嵌对话框');
  // node 解析阶段就会拒绝「非 async 函数里 await」，因此能构造出函数即证明每个
  // 调用点的 async 上下文都正确。
  assert.doesNotThrow(() => new Function(scriptCode), '内联脚本必须能被解析');
});

/* ───────────────────────── 出货代码的行为验证 ───────────────────────── */

/** 只截取确认框的实现，不牵扯页面其它逻辑。 */
function confirmDialogSource() {
  const start = scriptBody.indexOf('let activeConfirm = null;');
  assert.notEqual(start, -1, '必须能定位确认框实现（activeConfirm 声明）');
  const marker = 'window.__mcpConfirm = confirmDialog;';
  const end = scriptBody.indexOf(marker, start);
  assert.notEqual(end, -1, '必须能定位确认框实现的结尾');
  return scriptBody.slice(start, end + marker.length);
}

const CONFIRM_IDS = ['confirmMask', 'confirmBox', 'confirm-title', 'confirm-message', 'confirm-ok', 'confirm-cancel'];

/** 手写最小 DOM 替身：只实现确认框真正调用的成员。 */
function makeDom() {
  const listeners = new Map();
  const byId = new Map();
  for (const id of CONFIRM_IDS) {
    const classes = new Set();
    const attrs = new Map();
    byId.set(id, {
      id,
      textContent: '',
      disabled: false,
      isConnected: true,
      classes,
      attrs,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      setAttribute: (name, value) => attrs.set(name, value),
      getAttribute: (name) => attrs.get(name),
      addEventListener(type, handler) {
        if (!listeners.has(id)) listeners.set(id, new Map());
        listeners.get(id).set(type, handler);
      },
      /** 直接触发本节点当前注册的点击处理（不受 listeners 里后注册覆盖的影响）。 */
      click() { listeners.get(id)?.get('click')?.({ target: byId.get(id) }); },
      focus() { documentStub.activeElement = this; },
    });
  }
  const documentStub = { activeElement: null };
  const timers = [];
  const windowStub = {};
  const $ = (selector) => byId.get(String(selector).replace(/^#/, '')) ?? null;
  return {
    byId,
    document: documentStub,
    window: windowStub,
    timers,
    $,
    /** 立即执行挂起的 setTimeout 回调（对话框用它把初始焦点延到下一帧）。 */
    flushTimers() { while (timers.length) timers.shift()(); },
    fire(id, type, event = {}) {
      const handler = listeners.get(id)?.get(type);
      assert.ok(handler, `${id} 上应注册了 ${type} 监听`);
      handler(event);
    },
    /** 记录 preventDefault / stopPropagation 是否被调用。 */
    keyEvent(key, extra = {}) {
      const seen = { prevented: false, stopped: false };
      return {
        event: {
          key,
          preventDefault() { seen.prevented = true; },
          stopPropagation() { seen.stopped = true; },
          ...extra,
        },
        seen,
      };
    },
  };
}

function makeConfirmDialog() {
  const dom = makeDom();
  // 确认框的默认文案现在走面板 i18n 的 t()（默认语言中文时是恒等函数）；
  // 传入 `(s) => s` 即可复现既有中文断言，符合 docs/I18N.md §7 的约定。
  const factory = new Function(
    'document', 'window', '$', 'setTimeout', 't',
    `${confirmDialogSource()}; return confirmDialog;`,
  );
  const confirmDialog = factory(dom.document, dom.window, dom.$, (callback) => dom.timers.push(callback), (s) => s);
  return { confirmDialog, dom };
}

test('确认框返回 Promise；「确认」resolve true，「取消」resolve false', async () => {
  const ok = makeConfirmDialog();
  const okPromise = ok.confirmDialog({ title: '断开连接', message: '确认断开？', confirmLabel: '断开' });
  assert.equal(typeof okPromise.then, 'function', '必须返回 thenable，调用点才能 await');
  assert.equal(ok.dom.byId.get('confirm-title').textContent, '断开连接');
  assert.equal(ok.dom.byId.get('confirm-message').textContent, '确认断开？');
  assert.equal(ok.dom.byId.get('confirm-ok').textContent, '断开');
  assert.equal(ok.dom.byId.get('confirmMask').classes.has('show'), true, '打开时应显示遮罩');
  ok.dom.fire('confirm-ok', 'click');
  assert.equal(await okPromise, true);

  const cancel = makeConfirmDialog();
  const cancelPromise = cancel.confirmDialog({ title: 'T', message: 'M' });
  cancel.dom.fire('confirm-cancel', 'click');
  assert.equal(await cancelPromise, false);
});

test('确认框：Escape 取消、Enter 确认、点遮罩取消，关闭后遮罩收起', async () => {
  const { confirmDialog, dom } = makeConfirmDialog();
  const escape = confirmDialog({ title: 'T', message: 'M' });
  const escapeKey = dom.keyEvent('Escape');
  dom.fire('confirmMask', 'keydown', escapeKey.event);
  assert.equal(await escape, false, 'Escape 应等价于取消');
  assert.equal(escapeKey.seen.stopped, true, '必须阻止冒泡，否则 document 上的模态 Esc 会一并关掉表单');
  assert.equal(dom.byId.get('confirmMask').classes.has('show'), false, '关闭后遮罩必须收起');
  assert.equal(dom.byId.get('confirmMask').getAttribute('aria-hidden'), 'true');

  const second = makeConfirmDialog();
  const enter = second.confirmDialog({ title: 'T', message: 'M' });
  second.dom.fire('confirmMask', 'keydown', second.dom.keyEvent('Enter').event);
  assert.equal(await enter, false, '默认聚焦取消时 Enter 必须取消');
  const confirmed = second.confirmDialog({ title: 'T', message: 'M' });
  second.dom.byId.get('confirm-ok').focus();
  second.dom.fire('confirmMask', 'keydown', second.dom.keyEvent('Enter').event);
  assert.equal(await confirmed, true, '只有聚焦确认时 Enter 才确认');

  const third = makeConfirmDialog();
  const masked = third.confirmDialog({ title: 'T', message: 'M' });
  third.dom.fire('confirmMask', 'click', { target: { id: 'confirmMask' } });
  assert.equal(await masked, false, '点遮罩应等价于取消');
});

test('确认框打开时焦点落在「取消」这一安全选项，关闭后还给触发元素', async () => {
  const { confirmDialog, dom } = makeConfirmDialog();
  const opener = { isConnected: true, focus() { dom.document.activeElement = this; } };
  dom.document.activeElement = opener;
  const promise = confirmDialog({ title: 'T', message: 'M' });
  dom.flushTimers();
  assert.equal(dom.document.activeElement, dom.byId.get('confirm-cancel'), '默认焦点应是「取消」');
  dom.fire('confirm-ok', 'click');
  await promise;
  assert.equal(dom.document.activeElement, opener, '关闭后焦点必须回到触发确认的元素');
});

test('确认框内 Tab 在「取消 / 确认」之间循环，不会跑到页面其它元素', async () => {
  const { confirmDialog, dom } = makeConfirmDialog();
  const promise = confirmDialog({ title: 'T', message: 'M', confirmLabel: '确认' });
  dom.flushTimers();
  assert.equal(dom.document.activeElement, dom.byId.get('confirm-cancel'));
  const tab = dom.keyEvent('Tab');
  dom.fire('confirmMask', 'keydown', tab.event);
  assert.equal(tab.seen.prevented, true, '确认框内部自行接管 Tab');
  assert.equal(dom.document.activeElement, dom.byId.get('confirm-ok'), 'Tab 前进到「确认」');
  dom.fire('confirmMask', 'keydown', dom.keyEvent('Tab').event);
  assert.equal(dom.document.activeElement, dom.byId.get('confirm-cancel'), 'Tab 再回到「取消」');
  dom.fire('confirm-cancel', 'click');
  await promise;
});

test('重复触发确认时，前一个以「取消」收尾而不是永远挂起', async () => {
  // 两个确认共用同一套 #confirm-* 节点，所以直接调节点上的点击处理，
  // 不受 dom.fire 的 Map 覆盖影响（它记的是最后一次注册的处理）。
  const { confirmDialog, dom } = makeConfirmDialog();
  const first = confirmDialog({ title: '先', message: 'A' });
  const second = confirmDialog({ title: '后', message: 'B' });
  assert.equal(await first, false, '被覆盖的确认必须 resolve，否则它的 await 永远不返回');
  assert.equal(dom.byId.get('confirm-title').textContent, '后', '后到的确认接管对话框');
  assert.equal(dom.byId.get('confirmMask').classes.has('show'), true, '对话框仍然开着');
  dom.byId.get('confirm-ok').click();
  assert.equal(await second, true, '后到的确认仍能正常 resolve');
  assert.equal(dom.byId.get('confirmMask').classes.has('show'), false);
});
