#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function readJson(path) {
  return JSON.parse(await readFile(join(ROOT, path), 'utf8'));
}

async function readText(path) {
  return readFile(join(ROOT, path), 'utf8');
}

function sameMembers(left, right) {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function yamlSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function githubHeaders() {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'dsh-mcp-connector-marketing-check',
    'x-github-api-version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

export async function checkMarketingMetadata({ live = false, liveGithub = live, liveNpm = live } = {}) {
  const [metadata, packageJson, readmeZh, readmeEn, externalListing, contributing, ui] = await Promise.all([
    readJson('marketing/metadata.json'),
    readJson('package.json'),
    readText('README.md'),
    readText('README.en.md'),
    readText('duhu2000__dsh-mcp-connector.yml'),
    readText('CONTRIBUTING.md'),
    readText('ui/index.html'),
  ]);
  const errors = [];
  const expect = (condition, message) => { if (!condition) errors.push(message); };
  const contains = (text, expected, message) => expect(text.includes(expected), message);

  expect(metadata.schemaVersion === 1, 'marketing/metadata.json must use schemaVersion 1');
  expect(packageJson.name === metadata.packageName, 'package name differs from marketing metadata');
  expect(packageJson.description === metadata.npm.description, 'package description differs from marketing metadata');

  const packageKeywords = packageJson.keywords || [];
  for (const keyword of metadata.npm.requiredKeywords) {
    expect(packageKeywords.includes(keyword), `package keywords missing ${keyword}`);
  }

  const topics = metadata.github.topics || [];
  expect(topics.length <= 20, 'GitHub topics exceed the 20-topic limit');
  expect(new Set(topics).size === topics.length, 'GitHub topics contain duplicates');
  for (const topic of topics) {
    expect(packageKeywords.includes(topic), `GitHub topic ${topic} is not represented in package keywords`);
  }

  contains(readmeZh, metadata.readme.heroZh, 'Chinese README hero differs from marketing metadata');
  contains(readmeEn, metadata.readme.heroEn, 'English README hero differs from marketing metadata');
  contains(readmeZh, metadata.readme.ctaZh, 'Chinese README CTA differs from marketing metadata');
  contains(readmeEn, metadata.readme.ctaEn, 'English README CTA differs from marketing metadata');
  contains(externalListing, `en: ${yamlSingleQuoted(metadata.externalListing.en)}`, 'external English listing differs from marketing metadata');
  contains(externalListing, `zh: ${yamlSingleQuoted(metadata.externalListing.zh)}`, 'external Chinese listing differs from marketing metadata');
  contains(contributing, metadata.links.firstIssues, 'contributor guide is missing the good first issue path');
  for (const key of ['stars', 'contributing', 'connectorOnboarding']) {
    contains(ui, metadata.links[key], `installed-state CTA is missing ${key} link`);
  }

  expect(!/\b\d+\s+(?:curated\s+)?connectors?\b/i.test(packageJson.description), 'package description contains a static connector count');

  if (liveGithub) {
    const repositoryUrl = `https://api.github.com/repos/${metadata.repository}`;
    const repository = await fetchJson(repositoryUrl, { headers: githubHeaders() });
    expect(repository.description === metadata.github.description, 'live GitHub description differs from marketing metadata');
    expect(sameMembers(repository.topics || [], topics), 'live GitHub topics differ from marketing metadata');
  }

  if (liveNpm) {
    const publishedPackage = await fetchJson(`https://registry.npmjs.org/${metadata.packageName}/latest`);
    expect(publishedPackage.description === metadata.npm.description, 'live npm description differs from marketing metadata');
    for (const keyword of metadata.npm.requiredKeywords) {
      expect((publishedPackage.keywords || []).includes(keyword), `live npm keywords missing ${keyword}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n- '));
  return metadata;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const live = process.argv.includes('--live');
  const liveGithub = live || process.argv.includes('--live-github');
  const liveNpm = live || process.argv.includes('--live-npm');
  checkMarketingMetadata({ liveGithub, liveNpm }).then((metadata) => {
    const liveTargets = [liveGithub ? 'GitHub' : '', liveNpm ? 'npm' : ''].filter(Boolean).join('/');
    console.log(`营销元数据校验通过：${metadata.packageName}${liveTargets ? `（含 ${liveTargets} 线上状态）` : ''}`);
  }).catch((error) => {
    console.error(`营销元数据校验失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
