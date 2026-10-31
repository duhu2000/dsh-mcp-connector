import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_TEMPLATE_FORMAT,
  ShareTemplateSafetyError,
  assertShareableConnectionTemplate,
  createShareableTemplateFromCatalog,
  createShareableTemplateFromConnection,
  previewShareableConnectionTemplate,
} from '../lib/shareable-connection-template.js';
import { loadBundledCatalog } from '../lib/catalog.js';
import { normalizeJsonImport } from '../lib/connectors/json-connector.js';

function record(overrides = {}) {
  return {
    key: 'custom-demo',
    connectorId: '__custom__',
    kind: 'manual',
    name: 'Demo',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    serverName: 'demo',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const BUNDLED = loadBundledCatalog().filter((item) => item.published !== false);

function bundledWith(predicate) {
  const descriptor = BUNDLED.find((item) => item.servers.some(predicate));
  assert.ok(descriptor, '测试需要对应传输的包内已发布目录项');
  const server = descriptor.servers.find(predicate);
  return { descriptor, server };
}

test('凭据型 HTTP 模板只输出占位符，目标导入必须重填', () => {
  const template = createShareableTemplateFromConnection(record({
    auth: { mode: 'api-key', apiKeyHeader: 'X-Api-Key', apiKeyValue: 'source-secret' },
  }), { generatedAt: 0 });
  const serialized = JSON.stringify(template);
  assert.equal(template.format, SHARE_TEMPLATE_FORMAT);
  assert.doesNotMatch(serialized, /source-secret/);
  assert.equal(template.connections[0].apiKeyValue, '<REDACTED:REENTER>');
  assert.equal(template.connections[0].url, '<REDACTED:REENTER>');
  assert.throws(() => normalizeJsonImport(template), /脱敏导出仍有 2 个待补值/);

  template.connections[0].url = 'https://target.example/mcp';
  template.connections[0].apiKeyValue = 'target-device-secret';
  const imported = normalizeJsonImport(template);
  assert.equal(imported.records[0].auth.apiKeyValue, 'target-device-secret');
});

test('自定义 Header 与 stdio fail closed，不在错误中回显敏感值', () => {
  const cases = [
    record({ headers: { 'X-Tenant': 'private-tenant' } }),
    record({ transport: 'stdio', url: undefined, command: '/Users/me/bin/mcp', args: ['--token', 'secret'], env: { TOKEN: 'secret' } }),
  ];
  for (const value of cases) {
    assert.throws(
      () => createShareableTemplateFromConnection(value),
      (error) => error instanceof ShareTemplateSafetyError && !/private-tenant|password|token=secret|\/Users\/me/.test(error.message),
    );
  }
});

test('自定义 URL 的 userinfo、租户子域、路径、查询串和编码值均不进入模板', () => {
  const secrets = [
    'https://user:password@example.com/mcp',
    'https://tenant-8931.example.com/mcp',
    'https://example.com/customer/tenant-8931/token-secret',
    'https://example.com/mcp?token=url-secret',
    'https://example.com/mcp/%74%6f%6b%65%6e-secret',
    'https://127.0.0.1/mcp',
  ];
  for (const url of secrets) {
    const text = JSON.stringify(createShareableTemplateFromConnection(record({ url })));
    assert.match(text, /<REDACTED:REENTER>/);
    for (const fragment of ['password', 'tenant-8931', 'token-secret', 'url-secret', '%74%6f%6b%65%6e', '127.0.0.1']) {
      assert.doesNotMatch(text, new RegExp(fragment.replaceAll('.', '\\.')));
    }
  }
});

test('自定义显示名、serverName 和非通用 API Header 不得成为隐蔽通道', () => {
  const template = createShareableTemplateFromConnection(record({
    name: 'Customer Alpha secret',
    serverName: 'tenant-secret',
    auth: { mode: 'api-key', apiKeyHeader: 'X-Api-Key', apiKeyValue: 'source-secret' },
  }));
  const text = JSON.stringify(template);
  assert.doesNotMatch(text, /Customer Alpha|tenant-secret|source-secret/);
  assert.equal(template.connections[0].name, '自定义 MCP 连接');
  assert.equal(template.connections[0].serverName, 'custom-mcp');

  assert.throws(
    () => createShareableTemplateFromConnection(record({
      auth: { mode: 'api-key', apiKeyHeader: 'X-Tenant-8931', apiKeyValue: 'secret' },
    })),
    (error) => error instanceof ShareTemplateSafetyError
      && error.code === 'API_KEY_HEADER_NOT_SHAREABLE'
      && !/8931|secret/.test(error.message),
  );
});

test('公开目录 HTTP 也只输出 ID/serverKey 引用，不复制端点或 Header', () => {
  const { descriptor, server } = bundledWith((item) => item.transport === 'streamable-http');
  const template = createShareableTemplateFromCatalog({
    connectorId: descriptor.id,
    serverKey: server.serverKey,
    generatedAt: 0,
  });
  assert.deepEqual(template.source, {
    kind: 'catalog', connectorId: descriptor.id, serverKey: server.serverKey,
  });
  assert.equal(template.connections.length, 0);
  assert.equal(template.catalogConnections[0].action, 'connect-from-catalog');
  assert.doesNotMatch(JSON.stringify(template), /https?:|X-Region|public-default|X-Api-Key/);
  const preview = previewShareableConnectionTemplate(template);
  assert.equal(preview.requiresCredentialReentry, false);
  assert.equal(preview.requiresExplicitConfirmation, true);
  assert.equal(preview.executableConfigurationIncluded, false);
});

test('公开目录 OAuth 和 stdio 只输出重连引用，不携带 CLI 或 env', () => {
  const oauthEntry = BUNDLED.find((item) => item.auth.mode === 'oauth2-pkce');
  assert.ok(oauthEntry, '测试需要包内 OAuth 目录项');
  const oauthServer = oauthEntry.servers[0];
  const oauth = createShareableTemplateFromCatalog({
    connectorId: oauthEntry.id,
    serverKey: oauthServer.serverKey,
  });
  assert.equal(oauth.catalogConnections[0].action, 'connect-from-catalog');
  assert.equal(oauth.connections.length, 0);

  const { descriptor: stdioDescriptor, server: stdioServer } = bundledWith((item) => item.transport === 'stdio');
  const stdio = createShareableTemplateFromCatalog({
    connectorId: stdioDescriptor.id,
    serverKey: stdioServer.serverKey,
  });
  const text = JSON.stringify(stdio);
  assert.equal(stdio.catalogConnections[0].action, 'connect-from-catalog');
  assert.doesNotMatch(text, /npx|@vendor\/mcp|LOG_LEVEL|info/);
  assert.deepEqual(previewShareableConnectionTemplate(stdio), {
    format: SHARE_TEMPLATE_FORMAT,
    version: 1,
    action: 'connect-from-catalog',
    name: stdioDescriptor.name,
    serverName: stdioServer.serverName,
    requiresCredentialReentry: false,
    missingFields: [],
    requiresExplicitConfirmation: true,
    executableConfigurationIncluded: false,
    json: JSON.stringify(stdio, null, 2),
  });
});

test('严格验证器拒绝未知字段和未脱敏值，不静默过滤', () => {
  const template = createShareableTemplateFromConnection(record({ auth: { mode: 'api-key', apiKeyHeader: 'X-Api-Key', apiKeyValue: 'secret' } }));
  template.connections[0].unexpected = 'secret';
  assert.throws(
    () => assertShareableConnectionTemplate(template),
    (error) => error instanceof ShareTemplateSafetyError
      && error.code === 'UNKNOWN_FIELD'
      && !/unexpected|secret/.test(error.message),
  );

  delete template.connections[0].unexpected;
  template.connections[0].apiKeyValue = 'actual-secret';
  assert.throws(() => assertShareableConnectionTemplate(template), /API Key 模板只能携带重填占位符/);
});

test('严格验证器拒绝 instructions、名称、鉴权互斥字段与 redactedFields 夹带数据', () => {
  const base = createShareableTemplateFromConnection(record());

  const instructions = structuredClone(base);
  instructions.instructions = 'secret-in-instructions';
  assert.throws(() => assertShareableConnectionTemplate(instructions), /固定安全说明/);

  const name = structuredClone(base);
  name.connections[0].name = 'tenant-secret';
  assert.throws(() => assertShareableConnectionTemplate(name), /固定公开值/);

  const auth = structuredClone(base);
  auth.connections[0].bearerToken = 'hidden-secret';
  assert.throws(() => assertShareableConnectionTemplate(auth), /none 鉴权模板/);

  const redactions = structuredClone(base);
  redactions.connections[0].redactedFields.push('hidden-secret');
  assert.throws(() => assertShareableConnectionTemplate(redactions), /待重填字段完全一致/);
});

test('严格验证器拒绝 __proto__、控制字符、身份不一致和未发布目录项', () => {
  const template = createShareableTemplateFromConnection(record());
  const withProto = JSON.parse(JSON.stringify(template).replace(
    '"format":',
    '"__proto__":{"polluted":true},"format":',
  ));
  assert.throws(
    () => assertShareableConnectionTemplate(withProto),
    (error) => error instanceof ShareTemplateSafetyError
      && error.code === 'UNKNOWN_FIELD'
      && !/__proto__|polluted/.test(error.message),
  );

  template.connections[0].name = 'bad\u0000name';
  assert.throws(() => assertShareableConnectionTemplate(template), /控制字符/);

  const { descriptor, server } = bundledWith((item) => item.transport === 'streamable-http');
  const catalog = createShareableTemplateFromCatalog({
    connectorId: descriptor.id,
    serverKey: server.serverKey,
  });
  catalog.catalogConnections[0].serverKey = 'other';
  assert.throws(() => assertShareableConnectionTemplate(catalog), /身份不一致/);
  assert.throws(
    () => createShareableTemplateFromCatalog({ connectorId: 'not-in-reviewed-catalog', serverKey: 'main' }),
    (error) => error instanceof ShareTemplateSafetyError && error.code === 'CATALOG_NOT_PUBLISHED',
  );
});

test('伪造公开 descriptor 不能把租户标识伪装成已脱敏目录引用', () => {
  assert.throws(
    () => createShareableTemplateFromCatalog({
      connectorId: 'tenant-secret-abc',
      serverKey: 'main',
      name: 'Customer Alpha secret',
      serverName: 'tenant-secret',
      url: 'https://tenant-secret.example/mcp',
    }),
    (error) => error instanceof ShareTemplateSafetyError
      && error.code === 'CATALOG_NOT_PUBLISHED'
      && !/Customer Alpha|tenant-secret\.example/.test(error.message),
  );
});

test('严格验证器重新核对包内目录，拒绝伪造 ID 和夹带名称', () => {
  const { descriptor, server } = bundledWith((item) => item.transport === 'streamable-http');
  const base = createShareableTemplateFromCatalog({
    connectorId: descriptor.id,
    serverKey: server.serverKey,
  });

  const forgedIdentity = structuredClone(base);
  forgedIdentity.source.connectorId = 'tenant-secret-abc';
  forgedIdentity.catalogConnections[0].connectorId = 'tenant-secret-abc';
  forgedIdentity.catalogConnections[0].name = 'Customer Alpha secret';
  forgedIdentity.catalogConnections[0].serverName = 'tenant-secret';
  assert.throws(
    () => assertShareableConnectionTemplate(forgedIdentity),
    (error) => error instanceof ShareTemplateSafetyError
      && error.code === 'CATALOG_NOT_PUBLISHED'
      && !/tenant-secret|Customer Alpha/.test(error.message),
  );

  for (const [field, value] of [
    ['name', 'Customer Alpha secret'],
    ['serverName', 'tenant-secret'],
  ]) {
    const forgedMetadata = structuredClone(base);
    forgedMetadata.catalogConnections[0][field] = value;
    assert.throws(
      () => assertShareableConnectionTemplate(forgedMetadata),
      (error) => error instanceof ShareTemplateSafetyError
        && error.code === 'CATALOG_REFERENCE_MISMATCH'
        && !/tenant-secret|Customer Alpha/.test(error.message),
    );
  }
});

test('无鉴权公网 HTTP 可经既有导入校验归一，仍要求显式确认', () => {
  const template = createShareableTemplateFromConnection(record());
  const preview = previewShareableConnectionTemplate(template);
  assert.equal(preview.requiresCredentialReentry, true);
  assert.equal(preview.requiresExplicitConfirmation, true);
  assert.throws(() => normalizeJsonImport(template), /脱敏导出仍有 1 个待补值/);
  template.connections[0].url = 'https://target.example/mcp';
  assert.equal(normalizeJsonImport(template).records.length, 1);
});
