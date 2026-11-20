// Conservative structural checks against the live Host definition, not the
// truncated display cache. This is not a complete JSON Schema validator.
// Never coerce, flatten, fill in or retry arguments for a metered MCP service.
export function inputShapeError(schema, value, path = 'arguments', depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 64) return undefined;
  // These constructs need a complete dialect-aware resolver. Do not guess.
  if (schema.$ref || schema.oneOf || schema.anyOf || schema.allOf || schema.if) return undefined;
  if (value === null && schema.nullable === true) return undefined;
  const matches = {
    object: () => value !== null && typeof value === 'object' && !Array.isArray(value),
    array: () => Array.isArray(value),
    string: () => typeof value === 'string',
    boolean: () => typeof value === 'boolean',
    number: () => typeof value === 'number' && Number.isFinite(value),
    integer: () => Number.isInteger(value),
    null: () => value === null,
  };
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.every((type) => Object.hasOwn(matches, type)) && !types.some((type) => matches[type]())) {
    return `${path}: expected ${types.join(' | ')}`;
  }
  if (matches.object()) {
    const properties = schema.properties ?? {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.hasOwn(value, key)) return `${path}.${key}: required`;
    }
    for (const [key, child] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) continue;
      const error = inputShapeError(child, value[key], `${path}.${key}`, depth + 1);
      if (error) return error;
    }
  } else if (matches.array() && schema.items && !Array.isArray(schema.items)) {
    for (let i = 0; i < value.length; i += 1) {
      const error = inputShapeError(schema.items, value[i], `${path}[${i}]`, depth + 1);
      if (error) return error;
    }
  }
  return undefined;
}

export function createToolInputGuard(ctx, { isManagedTool, logger } = {}) {
  if (typeof ctx.tools?.guard !== 'function' || typeof ctx.tools?.get !== 'function') {
    logger?.warn?.('MCP input shape guard unavailable: Host requires tools.guard and tools.get');
    return { dispose() {}, supported: false };
  }
  const dispose = ctx.tools.guard((execution) => {
    if (!isManagedTool(execution.name)) return undefined;
    const definition = ctx.tools.get(execution.name, execution.agent);
    // Hidden/restricted tools remain subject to Host governance. This guard
    // cannot grant access or restore a filtered tool definition.
    if (!definition) return undefined;
    const error = inputShapeError(definition.parameters, execution.arguments);
    if (!error) return undefined;
    // Only schema field paths/types; never echo argument values or credentials.
    return `MCP_INPUT_SHAPE_INVALID: ${error}. Request was not sent to the MCP server. Preserve nested objects and follow the tool parameter schema. Do not automatically retry a metered acceptance call.`;
  });
  return { dispose, supported: true };
}
