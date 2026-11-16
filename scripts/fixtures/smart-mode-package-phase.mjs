import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
// Synthetic package lifecycle only. The parent owns marker validation/cleanup.
const inputs = JSON.parse(await fs.readFile(process.env.DSH_SMART_PACKAGE_INPUTS, 'utf8'));
const artifact = inputs.artifact;
const [profileName, phase, expectedVersion] = process.argv.slice(2);
assert.ok(['fresh', 'upgrade'].includes(profileName));
const profile = join(inputs.home, 'profiles', profileName);
assert.equal(JSON.parse(await fs.readFile(join(profile, 'validation-profile.json'), 'utf8')).syntheticOnly, true);
process.env.DSH_HOME = inputs.home;
process.env.DSH_HOST_INTEGRATION_ANCHOR = inputs.anchor;
const fixture = await import('./smart-mode-production.mjs');
const { signedEvidenceFixture } = await import('./read-only-evidence.mjs');
const require = createRequire(createRequire(inputs.anchor).resolve('@deepseek-ai/dsh-agent-loop'));
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const { PluginPackages, createRuntimeResolution, loadProfileDirectory, resolveBundleDir } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href);
const bootRoot = new Context();
const loaded = loadProfileDirectory('dsh', profile, inputs.anchor);
const resolution = await createRuntimeResolution({ installAnchor: inputs.anchor, profile: loaded, home: inputs.home });
await bootRoot.plugin(PluginPackages, { resolution }).await();
const installedDir = resolveBundleDir('dsh', 'dsh-mcp-connector', inputs.anchor, profile);
assert.ok((await fs.realpath(installedDir)).startsWith(`${await fs.realpath(profile)}${sep}`),
  'plugin must be owned by the temporary profile');
const installedManifest = JSON.parse(await fs.readFile(join(installedDir, 'package.json'), 'utf8'));
assert.equal(installedManifest.version, expectedVersion);
if (expectedVersion === inputs.candidateVersion) {
  assert.equal(createHash('sha256').update(await fs.readFile(join(installedDir, 'lib', 'index.js'))).digest('hex'), inputs.candidateIndexHash);
}
const implementation = await import(pathToFileURL(join(installedDir, 'lib', 'index.js')).href);
const stateFile = join(profile, '.synthetic-connector-state.json'), knownFile = join(profile, '.synthetic-session-ids.json');
const readOptional = async (file) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if(e.code==='ENOENT') return undefined; throw e; } };
const snapshot = await readOptional(stateFile), known = await readOptional(knownFile) ?? {};
async function fileHashes(dir) {
  const result = {};
  for (const name of await fs.readdir(dir, { recursive: true }).catch(e => {if(e.code==='ENOENT')return [];throw e;})) {
    const path = join(dir, name); if(!(await fs.stat(path)).isFile())continue;
    result[name] = createHash('sha256').update(await fs.readFile(path)).digest('hex');
  }
  return result;
}
const smartDir = join(profile, 'storages', 'mcp_connector_smart_v1');
const beforeSmart = await fileHashes(smartDir);
const results = [];
test(`installed package lifecycle ${profileName}/${phase}`, { timeout: 60000 }, async t => {
  t.after(() => bootRoot.fiber.dispose());
  const stable = expectedVersion === '0.2.109';
  const f = await fixture.productionHarness(t, { profileDir: profile, implementation, smartControl: !stable, storageState: snapshot,
    async persistStorage(value) { await fs.writeFile(`${stateFile}.tmp`, JSON.stringify(value), { mode: 0o600 }); await fs.rename(`${stateFile}.tmp`, stateFile); } });
  const ok = (r) => { assert.equal(r.ok,true,JSON.stringify(r));return r.result; };
  const create = async () => { const value = stable ? await f.services.sessionController.create({workspaceId:'workspace-a'}) : ok(await f.rpc('create'));
    await f.prompt(value.sessionId); return value.sessionId; };
  const resume = async id => { const value = await f.services.sessionController.resolveAgent(id); assert.ok(value.agent);
    await f.prompt(id); return value.agent; };
  const names = agent => f.h.ctx.tools.schemas(agent).map(row=>row.name);
  const management = agent => names(agent).filter(name=>name.startsWith('mcp_connector_'));
  const companyVisible = agent => names(agent).includes(known.item.publicName);
  const riskInvisible = agent => !names(agent).some(name=>name.startsWith('mcp__qcc-risk__'));
  const search = async id => f.waitFor(async()=>{const r=await f.rpc('search',{sessionId:id,query:'fixture'});return r.ok && r.result.items.some(x=>x.serverName==='qcc-company') ? r.result : undefined;});
  const prepare = async agent => f.h.ctx.tools.get('mcp_connector_discover',agent).execute({action:'prepare',capabilityIds:[known.item.capabilityId]}, {agent,signal:new AbortController().signal});
  if(phase==='baseline') {
    assert.equal(stable,true); known.old=await create();
    assert.equal(management(f.h.ctx.agents.get(known.old)).length,25); results.push('stable baseline creates a durable compatibility session');
  } else if(phase==='fresh' || phase==='upgrade') {
    assert.equal(stable,false); const state=ok(await f.rpc('state')); assert.equal(state.defaultMode,'compat');assert.equal(state.mounted,false);
    if(known.old) { const old=await resume(known.old); assert.equal(management(old).length,25); }
    else known.old=await create();
    await f.enable(); known.a=await create();known.b=await create();
    const found=await search(known.a); known.item=found.items.find(x=>x.serverName==='qcc-company');
    const source=ok(await f.rpc('inspect',{sessionId:known.a,sourceId:known.item.sourceId})).source;
    const signed=await signedEvidenceFixture(profile,f.h.scope,[source]); await signed.deliver();
    known.originalTrust=signed.trust; known.originalBundle=signed.bundle();
    const denied=await f.legacy('applyPolicy',{scope:'server',connectorId:'qcc-company',serverName:'qcc-risk',effect:'deny',expectedRevision:0});assert.equal(denied.ok,true,JSON.stringify(denied));
    const a=f.h.ctx.agents.get(known.a), b=f.h.ctx.agents.get(known.b); ok(await prepare(a));
    assert.equal(companyVisible(a),true);assert.equal(companyVisible(b),false);assert.equal(riskInvisible(a),true);
    results.push('default compatibility, old session preserved, smart A prepared, smart B isolated, governance persisted');
  } else if(phase==='restart' || phase==='repair') {
    assert.equal(ok(await f.rpc('state')).defaultMode,'smart');
    const old=await resume(known.old),a=await resume(known.a),b=await resume(known.b);
    assert.equal(management(old).length,25);assert.equal(management(a).length,2);assert.equal(companyVisible(a),false);assert.equal(companyVisible(b),false);assert.equal(riskInvisible(a),true);
    await search(known.a);ok(await prepare(a)); assert.equal(companyVisible(a),true);assert.equal(companyVisible(b),false);
    results.push('new OS process restores JSONL/mode/governance/evidence but never prepared state');
  } else if(phase==='withdraw') {
    const a=await resume(known.a);await search(known.a);
    const source=ok(await f.rpc('inspect',{sessionId:known.a,sourceId:known.item.sourceId})).source;
    const signed=await signedEvidenceFixture(profile,f.h.scope,[source]);await signed.deliver({...signed.payload,revision:2,reviews:[]});
    assert.equal(ok(await f.rpc('state')).readOnlyEvidence.revision,2); assert.equal((await prepare(a)).ok,false);
    results.push('synthetic revision 2 withdrawal is durable and cannot prepare');
  } else if(phase==='downgrade') {
    assert.equal(stable,true); const a=await resume(known.a);
    assert.equal(management(a).length,25);assert.equal(companyVisible(a),true);assert.equal(riskInvisible(a),true);
    assert.equal((await fetch(`${f.origin}/mcp-connector/smart-control/capabilities`,{headers:{cookie:f.cookie}})).status,404);
    known.duringStable=await create();
    results.push('explicit stable downgrade restores normal compatible injection, preserves governance, offers no smart controls');
  } else if(phase==='return') {
    const a=await resume(known.a), old=await resume(known.old), during=await resume(known.duringStable);
    assert.equal(management(a).length,2);assert.equal(management(old).length,25);assert.equal(management(during).length,25);
    assert.equal(companyVisible(a),false);assert.equal(riskInvisible(a),true);
    const evidence=join(profile,'smart-mode-evidence');
    await fs.writeFile(join(evidence,'trust.json'),JSON.stringify(known.originalTrust));await fs.writeFile(join(evidence,'bundle.json'),JSON.stringify(known.originalBundle));
    assert.equal(ok(await f.rpc('state')).readOnlyEvidence.code,'READ_ONLY_EVIDENCE_ROLLBACK');
    await search(known.a);assert.equal((await prepare(a)).ok,false);
    const source=ok(await f.rpc('inspect',{sessionId:known.a,sourceId:known.item.sourceId})).source;
    const signed=await signedEvidenceFixture(profile,f.h.scope,[source]);await signed.deliver({...signed.payload,revision:3});ok(await prepare(a));
    results.push('upgrade-back preserves smart and historical modes; revision floor rejects old signed evidence; synthetic revision 3 repairs');
  } else throw new Error('unknown phase');
  await fs.writeFile(knownFile,JSON.stringify(known),{mode:0o600});
  assert.deepEqual(f.h.errors,[]);await f.h.close();
  assert.ok(await readOptional(stateFile),'synthetic KV must really persist before the next process');
  if(phase==='downgrade') assert.deepEqual(await fileHashes(smartDir),beforeSmart,'stable code must not rewrite smart state or replay receipts');
  await fs.writeFile(join(artifact,`${profileName}-${phase}-result.json`),JSON.stringify({profileName,phase,pid:process.pid,
    node:process.versions.node,version:installedManifest.version,installedPackageDirectory:installedDir,results,
    currentDshConfigurationLoaded:false,temporaryManifestLoaded:true,syntheticDataOnly:true,
    realBusinessCalls:0,realModelCalls:0,syntheticMetadataCalls:f.metadataCalls},null,2));
});
