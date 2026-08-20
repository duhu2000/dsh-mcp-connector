#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateRegistryDescriptors } from '../lib/probe.js';

const directory = resolve(process.argv[2] ?? 'registry/connectors');
const output = resolve(process.argv[3] ?? 'registry/catalog.json');
const files = (await readdir(directory)).filter((file) => file.endsWith('.json') && !file.endsWith('.sample.json')).sort();
const raw = [];
for (const file of files) raw.push(JSON.parse(await readFile(resolve(directory, file), 'utf8')));
const connectors = validateRegistryDescriptors(raw).sort((a, b) => a.id.localeCompare(b.id));
await writeFile(output, `${JSON.stringify({ schemaVersion: 1, connectors }, null, 2)}\n`);
console.log(`registry: ${connectors.length} 个连接器 → ${output}`);
