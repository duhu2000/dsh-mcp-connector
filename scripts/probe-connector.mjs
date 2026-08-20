#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { probeConnector, validateRegistryDescriptors } from '../lib/probe.js';

function usage() {
  console.log(`用法: dsh-mcp-connector-probe <catalog-or-connector.json> [选项]

选项:
  --validate-only       只做 Schema、唯一性、URL 与密钥审计
  --timeout <ms>        单次网络请求超时（默认 15000）
  --output <file>       将 JSON 报告写入文件
  --allow-partial       partial 不作为失败退出
  --help                显示帮助`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

let input;
let output;
let timeoutMs = 15_000;
let validateOnly = false;
let allowPartial = false;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--validate-only') validateOnly = true;
  else if (arg === '--allow-partial') allowPartial = true;
  else if (arg === '--timeout') timeoutMs = Number(args[++i]);
  else if (arg === '--output') output = args[++i];
  else if (arg.startsWith('--')) throw new Error(`未知选项: ${arg}`);
  else if (!input) input = arg;
  else throw new Error(`多余参数: ${arg}`);
}
if (!input) throw new Error('缺少 connector/catalog JSON 文件');
if (!Number.isFinite(timeoutMs) || timeoutMs < 100) throw new Error('--timeout 必须是不小于 100 的数字');

const raw = JSON.parse(await readFile(input, 'utf8'));
const list = Array.isArray(raw) ? raw : Array.isArray(raw?.connectors) ? raw.connectors : [raw];
const descriptors = validateRegistryDescriptors(list);
let report;
if (validateOnly) {
  report = {
    ok: true,
    mode: 'validate-only',
    checkedAt: Date.now(),
    connectors: descriptors.map((descriptor) => ({
      id: descriptor.id,
      servers: descriptor.servers.length,
      authMode: descriptor.auth.mode,
    })),
  };
} else {
  const results = [];
  for (const descriptor of descriptors) results.push(await probeConnector(descriptor, { timeoutMs }));
  report = {
    ok: results.every((result) => result.status === 'pass' || (allowPartial && result.status === 'partial')),
    mode: 'probe',
    checkedAt: Date.now(),
    results,
  };
}

const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) await writeFile(output, json, { mode: 0o600 });
else process.stdout.write(json);
if (!report.ok) process.exitCode = 1;
