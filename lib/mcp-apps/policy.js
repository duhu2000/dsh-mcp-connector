/** Protocol-only MCP Apps policy. No host/transport side effects. */
export const APP_MIME = 'text/html;profile=mcp-app';
export const APP_CAPABILITIES = Object.freeze({ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [APP_MIME] } } });
export const MAX_UI_BYTES = 2 * 1024 * 1024;

export function appDescriptor(tool) {
  const ui = tool?._meta?.ui;
  const uri = ui?.resourceUri ?? tool?._meta?.['ui/resourceUri'];
  const visibility = ui?.visibility ?? ['model', 'app'];
  if (!Array.isArray(visibility) || visibility.length === 0 || visibility.some(v => !['model', 'app'].includes(v))) throw new Error('INVALID_UI_VISIBILITY');
  if (uri !== undefined && (typeof uri !== 'string' || !uri.startsWith('ui://') || uri.length > 2048 || /[\s\u0000-\u001f]/u.test(uri))) throw new Error('INVALID_UI_URI');
  return { resourceUri: uri, modelVisible: visibility.includes('model'), appVisible: visibility.includes('app') };
}

/** Return only model-safe fields. UI _meta is intentionally absent. */
export function modelResult(result) {
  if (!result || !Array.isArray(result.content)) throw new Error('INVALID_TOOL_RESULT');
  // Clone prevents later mutation through the renderer side of the result.
  return structuredClone({ content: result.content, ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}), ...(result.isError === true ? { isError: true } : {}) });
}

export function readUiResource(result, expectedUri, { maxBytes = MAX_UI_BYTES } = {}) {
  if (!Array.isArray(result?.contents) || result.contents.length !== 1) throw new Error('INVALID_UI_RESOURCE');
  const resource = result.contents[0];
  if (resource.uri !== expectedUri || resource.mimeType !== APP_MIME || typeof resource.text !== 'string') throw new Error('INVALID_UI_RESOURCE');
  if (Buffer.byteLength(resource.text, 'utf8') > maxBytes) throw new Error('UI_RESOURCE_TOO_LARGE');
  const ui = resource._meta?.ui ?? {};
  // This initial policy supports self-contained apps only. Never silently ignore
  // a request for external access and advertise that it was granted.
  const csp = ui.csp ?? {};
  for (const field of ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains']) {
    if (csp[field] !== undefined && (!Array.isArray(csp[field]) || csp[field].length)) throw new Error('UI_EXTERNAL_ACCESS_NOT_SUPPORTED');
  }
  if (ui.permissions && Object.keys(ui.permissions).length) throw new Error('UI_PERMISSIONS_NOT_SUPPORTED');
  return { html: resource.text, mimeType: APP_MIME };
}
