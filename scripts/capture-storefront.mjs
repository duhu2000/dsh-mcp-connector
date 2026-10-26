// Re-render the real product UI using only a disposable credential-free harness.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { sourceFingerprint } from './check-media-freshness.mjs';
import { imageDimensions, gifDurationSeconds } from './check-storefront-screenshots.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const pkg = JSON.parse(await readFile('package.json','utf8'));
const scratch = await mkdtemp(join(tmpdir(), 'mcp-media-'));
// Explicitly clear external catalog injection; the harness cannot read a user's profile.
const env = {...process.env, MCP_CONNECTOR_UI_PORT: '0'};
delete env.MCP_CONNECTOR_UI_CATALOG_PATH;
const server = spawn(process.execPath, ['scripts/ui-harness.mjs'], {cwd:root, env, stdio:['ignore','pipe','pipe']});
let browser;
try {
  const base = await new Promise((resolveReady,reject) => {
    const timer=setTimeout(()=>reject(Error('Harness startup timeout')),15000);
    server.once('exit',code=>{clearTimeout(timer);reject(Error(`Harness exited ${code}`));});
    server.stdout.on('data',data=>{const m=data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolveReady(m[0]);}});
    server.stderr.on('data',data=>process.stderr.write(data));
  });
  browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1,locale:'zh-CN',timezoneId:'Asia/Shanghai',colorScheme:'light'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const paths=JSON.parse(await readFile('screenshots.json','utf8'));
  async function home(){await page.goto(base);await page.frameLocator('iframe').locator('.card').first().waitFor();}
  const frame=()=>page.frameLocator('iframe');
  const captured=[];
  async function shot(index){
    await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);
    await page.locator('.capture-version').getByText(`v${pkg.version}`,{exact:true}).waitFor();
    await page.getByText('无凭据 Mock',{exact:true}).waitFor();
    const path=paths[index];await page.screenshot({path, ...(path.endsWith('.jpg')?{quality:92}:{}),animations:'disabled'});
    captured.push(path);
  }
  await home();await shot(0);
  await frame().getByRole('button',{name:'详情',exact:true}).first().click();await frame().locator('#detail-overlay.active').waitFor();await shot(1);
  // Connect only to the local mock endpoint, never to a provider.
  await page.request.post(base+'/mcp-connector/api',{data:{method:'connect',params:{connectorId:'qcc-company'}}});
  await home();await frame().getByRole('button',{name:'详情',exact:true}).first().click();await frame().locator('#detail-overlay.active').waitFor();await frame().locator('#tools-summary').filter({hasText:'工具'}).waitFor();await frame().locator('#tools-summary').click();await frame().locator('.tool-item').first().scrollIntoViewIfNeeded();await shot(2);
  await home();await frame().locator('#add-connection').click();await frame().locator('#modalMask.show').waitFor();await shot(3);
  await home();await frame().locator('[data-view="tools"]').click();await frame().locator('[data-explorer-detail]').first().waitFor();await shot(4);
  await frame().locator('[data-explorer-detail]').first().click();await frame().locator('#modalMask.show').waitFor();await shot(5);
  await home();await frame().locator('[data-view="tools"]').click();await frame().locator('#explorer-status').selectOption('failed');await page.waitForTimeout(1000);await frame().locator('#explorer-connections details:not([open]) summary').click();await frame().locator('#explorer-connections details[open]').waitFor();await shot(6);
  if(errors.length)throw Error(`Browser errors: ${errors.join('; ')}`);
  // Encode actual captured frames; never paint new version labels onto old pixels.
  const frames=[0,1,2,4,5,6];
  for(let i=0;i<frames.length;i++)execFileSync('ffmpeg',['-loglevel','error','-y','-i',captured[frames[i]],join(scratch,`frame-${i}.png`)]);
  execFileSync('ffmpeg',['-loglevel','error','-y','-framerate','1/6','-i',join(scratch,'frame-%d.png'),'-vf','scale=960:540:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse','-loop','0','docs/demo.gif']);
  const capturedOn=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
  async function metadata(path){const bytes=await readFile(path);return {path,sha256:createHash('sha256').update(bytes).digest('hex'),...imageDimensions(bytes,path),capturedOn,sourceVersion:pkg.version,...(path.endsWith('.gif')?{durationSeconds:gifDurationSeconds(bytes)}:{})};}
  await writeFile('docs/screenshots/assets.json',JSON.stringify({schemaVersion:1,capture:{capturedOn,sourceVersion:pkg.version,sourceFingerprint:await sourceFingerprint(),browserViewport:{width:1280,height:720},productPanelWidth:800,desktopCardColumns:2,state:'credential-free-mock',notes:'All assets re-rendered from the current credential-free harness; no production profile, credentials or provider calls.'},screenshots:await Promise.all(paths.map(metadata)),demo:await metadata('docs/demo.gif')},null,2)+'\n');
  console.log(`Captured ${paths.length} screenshots and GIF from ${pkg.version}`);
} finally {await browser?.close();server.kill();await rm(scratch,{recursive:true,force:true});}
