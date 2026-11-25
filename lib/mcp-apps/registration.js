import { publicToolName } from '../governance.js';
import { appDescriptor, modelResult } from './policy.js';

/**
 * Single-owner tool registration for a connected Apps adapter.
 * The caller owns transport/OAuth and must dispose this registration before
 * changing connection generation. UI data never enters ToolRuntime.value; only an opaque receipt is persisted.
 */
export function registerAppTools({ runtime, client, tools, views, source, authorize, signal }) {
  const disposers = [];
  const definitions = [];
  const names = new Set();
  let disposed = false;
  const controller = new AbortController();
  for (const tool of tools) {
    if (typeof tool?.name !== 'string' || !tool.name) throw new Error('INVALID_APP_TOOL');
    const descriptor = appDescriptor(tool);
    if (!descriptor.modelVisible) continue;
    const name = publicToolName(source.serverName, tool.name);
    if (names.has(name)) throw new Error('DUPLICATE_APP_TOOL');
    names.add(name);
    definitions.push({
      name,
      description: tool.description ?? '',
      parameters: tool.inputSchema,
      output: {
        schema: { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {}, isError: { type: 'boolean' }, mcpApp: { type: 'object', properties: { viewId: { type: 'string' }, sessionId: { type: 'string' }, callId: { type: 'string' } }, required: ['viewId', 'sessionId', 'callId'], additionalProperties: false } }, required: ['content'], additionalProperties: false },
        render(_args, value) { return value.content; },
        presentationMeta(_args, value) { return value.mcpApp ? { mcpApp: value.mcpApp } : undefined; },
      },
      async execute(args, exec) {
        if (disposed) throw new Error('APP_CONNECTION_CLOSED');
        const sessionId = exec.agent?.session?.id;
        if (typeof sessionId !== 'string' || typeof exec.callId !== 'string') throw new Error('APP_REQUIRES_SESSION');
        const binding = { sessionId, callId: exec.callId, connectionId: source.connectionId, accountId: source.accountId, generation: source.generation };
        if (typeof authorize !== 'function' || await authorize({ ...binding, toolName: tool.name, action: 'model-call' }) !== true) throw new Error('APP_ACCESS_DENIED');
        if (disposed) throw new Error('APP_CONNECTION_CLOSED');
        const requestSignal = AbortSignal.any([controller.signal, exec.signal, signal].filter(Boolean));
        requestSignal.throwIfAborted();
        const result = await client.callTool({ name: tool.name, arguments: args }, { signal: requestSignal });
        requestSignal.throwIfAborted();
        const value = modelResult(result);
        if (result.isError === true) throw new Error(value.content.filter(block => block.type === 'text').map(block => block.text).join('\n') || 'MCP_TOOL_FAILED');
        if (descriptor.resourceUri && !result.isError) {
          const view = views.create({ binding, tool, args, result });
          value.mcpApp = view.presentation;
        }
        return value;
      },
    });
  }
  try {
    for (const definition of definitions) disposers.push(runtime.register(definition));
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    controller.abort();
    throw error;
  }
  return {
    toolNames: [...names],
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      views.invalidate(source.connectionId);
      for (const dispose of disposers.reverse()) dispose();
    },
  };
}
