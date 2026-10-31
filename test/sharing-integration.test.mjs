import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const slice = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));

function bridge() {
  const sent = [];
  const window = { parent: {}, __mcp: { sendPrompt(text) { sent.push(text); } } };
  const factory = new Function('window', '$', 'showToast', 'setPromptLaunchPending', 't', `
    let currentWorkspace = { workspaceId: 'test' }, promptRequestId = null, promptRequestTimer = null, draftHandoff = null;
    ${slice('  function openSharingDraft(', '  async function openSharingExperience(')}
    ${slice('  function finishPromptLaunch(', '  // First-use integration boundary:')}
    return { open: openSharingDraft, reply: finishPromptLaunch, pending: () => promptRequestId = 'request', noWorkspace: () => currentWorkspace = null };
  `);
  return { ...factory(window, () => null, () => {}, () => {}, text => text), sent, window };
}

test('sharing bridge resolves only on matching Host acknowledgement, never on request dispatch', async () => {
  const b = bridge();
  let completed = false;
  const promise = b.open('user draft').then(() => { completed = true; });
  b.pending();
  await Promise.resolve();
  assert.deepEqual(b.sent, ['user draft']);
  assert.equal(completed, false);
  b.reply('unrelated', true);
  await Promise.resolve();
  assert.equal(completed, false);
  b.reply('request', true);
  await promise;
  assert.equal(completed, true);
});

test('sharing bridge rejects Host failure and duplicate clicks without claiming success', async () => {
  const b = bridge();
  const first = b.open('first');
  b.pending();
  await assert.rejects(b.open('second'), /尚未完成/);
  const failed = assert.rejects(first, /超时/);
  b.reply('request', false, '超时');
  await failed;
  assert.deepEqual(b.sent, ['first']);
  const retry = b.open('retry');
  b.pending(); b.reply('request', true);
  await retry;
  assert.deepEqual(b.sent, ['first', 'retry']);
});

test('sharing bridge refuses standalone pages, missing workspace and blank drafts', async () => {
  const b = bridge();
  await assert.rejects(b.open(' '), /不能为空/);
  b.noWorkspace();
  await assert.rejects(b.open('draft'), /工作区/);
  b.window.parent = b.window;
  await assert.rejects(b.open('draft'), /DSH/);
  assert.deepEqual(b.sent, []);
});

function loader(loadSharing) {
  const root = { textContent: '' };
  const factory = new Function('loadSharing', 'root', 't', `
    let sharingSequence = 0, sharingDispose = null, visible = true;
    const $ = (selector) => selector === '#sharing-root' ? root : { classList: { contains: () => visible } };
    const openModal = () => { sharingSequence++; };
    const openSharingDraft = () => {}, showToast = () => {};
    ${slice('  async function openSharingExperience(', '  async function openFirstUse(').replace("import('./sharing-experience.js')", 'loadSharing()')}
    return { open: openSharingExperience, close: () => { visible = false; sharingSequence++; }, dispose: () => sharingDispose?.() };
  `);
  return { ...factory(loadSharing, root, text => text), root };
}

test('sharing editor lazy loads once requested, passes only explicit draft/message capabilities', async () => {
  let calls = 0, disposed = 0;
  const l = loader(async () => ({ mount(root, options) {
    calls++;
    assert.deepEqual(Object.keys(options).sort(), ['openDraft', 'showMessage']);
    return () => disposed++;
  } }));
  assert.equal(calls, 0);
  await l.open();
  assert.equal(calls, 1);
  l.dispose();
  assert.equal(disposed, 1);
});

test('closing before module load prevents mounting; load failure stays local and recoverable', async () => {
  let resolve, mounts = 0;
  const pending = new Promise((done) => { resolve = done; });
  const l = loader(() => pending);
  const opening = l.open();
  l.close(); resolve({ mount() { mounts++; } });
  await opening;
  assert.equal(mounts, 0);
  const failed = loader(async () => { throw Error('missing module'); });
  await failed.open();
  assert.match(failed.root.textContent, /加载失败/);
});

test('modal replacement and close dispose sharing listeners; harness serves the module', async () => {
  for (const [start, end] of [['  function openModal(', '  async function openToolDetail('], ['  function closeModal(', "  $('#modalMask').addEventListener"]]) {
    assert.match(slice(start, end), /sharingDispose\(\); sharingDispose = null/);
  }
  const harness = await readFile(new URL('../scripts/ui-harness.mjs', import.meta.url), 'utf8');
  assert.match(harness, /\/mcp-connector\/ui\/sharing-experience\.js/);
  assert.match(html, /white-space: pre-wrap; overflow-wrap: anywhere/);
});
