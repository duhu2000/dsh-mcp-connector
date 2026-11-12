import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = (await readFile(new URL('../ui/index.html', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');

function promptUi() {
  const buttons = [{ disabled: false, textContent: '发送', dataset: {} }];
  const nodes = new Map([
    ['#first-use-result', { textContent: '' }],
    ['#first-use-launch', { disabled: false }],
    ['#first-use-consent', { checked: true }],
  ]);
  const requests = [];
  const timers = new Map();
  const toasts = [];
  let timerId = 0;
  const window = { parent: { postMessage: (data) => requests.push(data) }, location: { origin: 'http://127.0.0.1:4173' } };
  const functions = html.slice(html.indexOf('  function setPromptLaunchPending('), html.indexOf('  // First-use integration boundary:'));
  const send = html.slice(html.indexOf('    sendPrompt(promptText) {'), html.indexOf('    async disconnectCurrent()'));
  const make = new Function('window', 'document', '$', 't', 'showToast', 'setTimeout', 'clearTimeout', `
    let promptRequestId = null, promptRequestTimer = null, draftHandoff = null;
    const PROMPT_REQUEST_TYPE = 'mcp-connector:start-session';
    ${functions}
    const api = { ${send} };
    return { send: api.sendPrompt, finish: finishPromptLaunch };
  `);
  const api = make(window, { querySelectorAll: () => buttons }, (id) => nodes.get(id), (text) => text,
    (message, ok) => toasts.push({ message, ok }),
    (fn) => { const id = ++timerId; timers.set(id, fn); return id; }, (id) => timers.delete(id));
  return { ...api, buttons, nodes, requests, timers, toasts };
}

test('示例发送拦截重复点击、匹配回执编号，失败后恢复按钮并允许重试', () => {
  const f = promptUi();
  f.send('示例');
  f.send('重复点击');
  assert.equal(f.requests.length, 1);
  assert.equal(f.buttons[0].disabled, true);
  f.finish('unrelated', true, '不应处理');
  assert.equal(f.buttons[0].disabled, true);
  f.finish(f.requests[0].requestId, false, '写入失败');
  assert.equal(f.buttons[0].disabled, false);
  assert.equal(f.buttons[0].textContent, '发送');
  assert.equal(f.nodes.get('#first-use-result').textContent, '写入失败');
  assert.equal(f.timers.size, 0);
  f.send('重试');
  assert.equal(f.requests.length, 2);
  f.finish(f.requests[1].requestId, true, '已带入新会话');
  assert.equal(f.buttons[0].disabled, false);
  assert.match(f.nodes.get('#first-use-result').textContent, /尚未发送或调用工具/);
});

test('示例发送超时后恢复，迟到回执不会影响后续请求', () => {
  const f = promptUi();
  f.send('第一次');
  const first = f.requests[0].requestId;
  [...f.timers.values()][0]();
  assert.equal(f.buttons[0].disabled, false);
  assert.match(f.toasts.at(-1).message, /超时/);
  f.send('第二次');
  f.finish(first, true, '迟到成功');
  assert.equal(f.buttons[0].disabled, true);
  f.finish(f.requests[1].requestId, false, '失败');
  assert.equal(f.buttons[0].disabled, false);
});

test('空白示例不会发送任何消息或创建超时任务', () => {
  const f = promptUi();
  f.send('  ');
  assert.deepEqual(f.requests, []);
  assert.equal(f.timers.size, 0);
});

test('开发壳只处理可信 iframe 请求，以纯文本展示模拟草稿并返回匹配回执', async () => {
  const source = await readFile(new URL('../scripts/ui-harness.mjs', import.meta.url), 'utf8');
  const capture = source.slice(source.indexOf('function captureShell()'), source.indexOf('const server = createServer'));
  const shell = new Function('process', 'packageJson', 'mockWorkspace', 'mockWorkspaces', `${capture}; return captureShell();`)(
    { env: {} }, { version: 'test' }, { title: '测试项目' }, []);
  const nodes = new Map();
  const callbacks = new Map();
  const replies = [];
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: id === '#mock-session', addEventListener: (type, fn) => callbacks.set(id + type, fn) });
    return nodes.get(id);
  };
  const frameWindow = { postMessage: (data) => replies.push(data) };
  node('iframe').contentWindow = frameWindow;
  const window = { location: { origin: 'http://127.0.0.1:4173' }, addEventListener: (type, fn) => callbacks.set(type, fn) };
  const script = shell.match(/<script>([\s\S]*?)<\/script>/)[1];
  new Function('window', 'document', 'requestAnimationFrame', script)(window, { querySelector: node }, (fn) => fn());
  const request = { type: 'mcp-connector:start-session', requestId: 'mock-1', prompt: '<script>example</script>' };
  const dispatch = (extras = {}) => callbacks.get('message')({ origin: window.location.origin, source: frameWindow, data: request, ...extras });
  dispatch({ source: {} });
  dispatch({ origin: 'https://other.example' });
  assert.deepEqual(replies, []);
  dispatch();
  assert.equal(node('#mock-draft').value, request.prompt);
  assert.match(node('#mock-session-target').textContent, /测试项目 · mock-session-1/);
  assert.equal(node('#mock-session').hidden, false);
  assert.equal(node('iframe').hidden, true);
  assert.equal(replies[0].requestId, 'mock-1');
  assert.equal(replies[0].ok, true);
  callbacks.get('#mock-returnclick')();
  assert.equal(node('iframe').hidden, false);
  assert.equal(node('#mock-session').hidden, true);
});
