import { randomBytes } from 'node:crypto';
import { appDescriptor, readUiResource, modelResult } from './policy.js';

const REQUIRED = ['sessionId', 'callId', 'connectionId', 'accountId', 'generation'];
function identity(input) {
  if (!input || REQUIRED.some(k => typeof input[k] !== 'string' || !input[k])) throw new Error('INVALID_APP_IDENTITY');
  return Object.fromEntries(REQUIRED.map(k => [k, input[k]]));
}

/** Memory-only view receipts. Host adapters supply trusted identity and policy. */
export class AppViews {
  #views = new Map();
  constructor({ now = Date.now, ttlMs = 15 * 60_000, maxViews = 100, maxResultBytes = 2 * 1024 * 1024 } = {}) {
    for (const n of [ttlMs, maxViews, maxResultBytes]) if (!Number.isSafeInteger(n) || n < 1) throw new Error('INVALID_APP_LIMIT');
    Object.assign(this, { now, ttlMs, maxViews, maxResultBytes });
  }
  #prune() {
    for (const [id, view] of this.#views) if (view.expiresAt <= this.now()) this.#views.delete(id);
  }
  create({ binding, tool, args, result }) {
    const source = identity(binding);
    const { resourceUri } = appDescriptor(tool);
    if (!resourceUri) throw new Error('TOOL_HAS_NO_APP');
    const safeResult = modelResult(result);
    const encoded = JSON.stringify({ args, result });
    if (Buffer.byteLength(encoded, 'utf8') > this.maxResultBytes) throw new Error('APP_RESULT_TOO_LARGE');
    this.#prune();
    if (this.#views.size >= this.maxViews) throw new Error('APP_VIEW_LIMIT');
    const viewId = randomBytes(32).toString('base64url');
    this.#views.set(viewId, { ...source, toolName: tool.name, resourceUri, args: structuredClone(args), result: structuredClone(result), expiresAt: this.now() + this.ttlMs, busy: false });
    return { model: safeResult, presentation: { viewId, sessionId: source.sessionId, callId: source.callId } };
  }
  #get(viewId, binding) {
    this.#prune();
    const source = identity(binding);
    const view = this.#views.get(viewId);
    if (!view || REQUIRED.some(k => source[k] !== view[k])) throw new Error('APP_VIEW_EXPIRED_OR_FORBIDDEN');
    return view;
  }
  async resource(viewId, binding, { client, authorize, signal }) {
    const view = this.#get(viewId, binding);
    if (typeof authorize !== 'function' || await authorize({ ...identity(view), toolName: view.toolName, action: 'read' }) !== true) throw new Error('APP_ACCESS_DENIED');
    this.#get(viewId, binding);
    signal?.throwIfAborted();
    const result = await client.readResource({ uri: view.resourceUri }, { signal });
    // Revalidate after async I/O: account changes/disposal must revoke in-flight reads.
    if (this.#get(viewId, binding) !== view) throw new Error('APP_VIEW_EXPIRED_OR_FORBIDDEN');
    return { ...readUiResource(result, view.resourceUri), arguments: structuredClone(view.args), result: structuredClone(view.result) };
  }
  async call(viewId, binding, { name, arguments: args = {} }, { client, tools, authorize, validateArguments, confirm, signal }) {
    const view = this.#get(viewId, binding);
    const tool = tools.find(t => t.name === name);
    // app visibility is necessary, not sufficient: current governance and input
    // validation must also approve every call, including after the model turn.
    if (!tool || !appDescriptor(tool).appVisible) throw new Error('TOOL_NOT_APP_VISIBLE');
    if (typeof validateArguments !== 'function' || await validateArguments(tool, args) !== true) throw new Error('INVALID_APP_ARGUMENTS');
    if (view.busy) throw new Error('APP_CALL_IN_PROGRESS');
    view.busy = true;
    try {
      if (typeof authorize !== 'function' || await authorize({ ...identity(view), toolName: name, action: 'call' }) !== true) throw new Error('APP_ACCESS_DENIED');
      // MCP annotations are hints, not a trusted grant to bypass confirmation.
      if (typeof confirm !== 'function' || await confirm({ toolName: name, arguments: structuredClone(args) }) !== true) throw new Error('APP_CONFIRMATION_REQUIRED');
      this.#get(viewId, binding); signal?.throwIfAborted();
      const result = await client.callTool({ name, arguments: structuredClone(args) }, { signal });
      this.#get(viewId, binding);
      modelResult(result); // Validate shape, but retain UI metadata for the App.
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > this.maxResultBytes) throw new Error('APP_RESULT_TOO_LARGE');
      return structuredClone(result);
    } finally { view.busy = false; }
  }
  invalidate(connectionId) {
    for (const [id, view] of this.#views) if (view.connectionId === connectionId) this.#views.delete(id);
  }
  clear() { this.#views.clear(); }
}
