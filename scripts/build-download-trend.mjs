import { mkdir, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const DAY = 86400000;
const date = ms => new Date(ms).toISOString().slice(0, 10);
export function validateDays(rows, start, end) {
  const map = new Map();
  for (const row of rows) {
    if (map.has(row.day) || !Number.isSafeInteger(row.downloads) || row.downloads < 0) throw new Error('Invalid/duplicate daily download count');
    map.set(row.day, row.downloads);
  }
  const result = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += DAY) {
    const day = date(t);
    if (!map.has(day)) throw new Error(`Missing day: ${day}; preserve previous chart`);
    result.push({ day, downloads: map.get(day) });
  }
  if (result.length !== map.size) throw new Error('Unexpected dates');
  return result;
}
export function summarize(rows) {
  let total = 0;
  const cumulative = rows.map(r => ({ day: r.day, value: total += r.downloads }));
  const weeks = [];
  for (let end = rows.length; end >= 7 && weeks.length < 12; end -= 7) {
    const slice = rows.slice(end - 7, end);
    weeks.unshift({ day: slice[0].day, value: slice.reduce((a, r) => a + r.downloads, 0) });
  }
  return { total, last30: rows.slice(-30).reduce((a,r) => a+r.downloads,0), cumulative, weeks };
}
const fmt = n => n.toLocaleString('en-US');
export function render(rows) {
  const s = summarize(rows);
  const graph = (points, y, height, color) => {
    const max = Math.max(1, ...points.map(p=>p.value));
    const path = points.map((p,i)=>`${i?'L':'M'}${80+i*800/Math.max(1,points.length-1)},${y+height-p.value/max*height}`).join(' ');
    return [0,.5,1].map(f=>`<path d="M80 ${y+height-height*f} H880" stroke="#e2e8f0"/><text x="70" y="${y+height-height*f+4}" text-anchor="end" font-size="12">${fmt(Math.round(max*f))}</text>`).join('')+`<path d="${path}" stroke="${color}" stroke-width="3" fill="none"/><text x="80" y="${y+height+23}" font-size="12">${points[0]?.day||''}</text><text x="880" y="${y+height+23}" text-anchor="end" font-size="12">${points.at(-1)?.day||''}</text>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600" role="img" aria-labelledby="title desc"><title id="title">dsh-mcp-connector npm download trends</title><desc id="desc">${fmt(s.total)} downloads from ${rows[0].day} through ${rows.at(-1).day}; ${fmt(s.last30)} in the latest 30 days. Downloads are not unique users or successful installs.</desc><rect width="960" height="600" rx="18" fill="#f8fafc"/><g font-family="Arial, sans-serif" fill="#334155"><text x="40" y="42" font-size="24" font-weight="bold">dsh-mcp-connector · npm downloads</text><text x="40" y="76" font-size="19">Cumulative: ${fmt(s.total)}     Last 30 days: ${fmt(s.last30)}</text><text x="40" y="105" font-size="13">${rows[0].day} – ${rows.at(-1).day} (UTC) · Source: npm Downloads API</text><text x="80" y="140" font-size="15">Cumulative downloads</text>${graph(s.cumulative,155,170,'#4f46e5')}<text x="80" y="385" font-size="15">Recent downloads · up to 12 consecutive 7-day periods</text>${graph(s.weeks,400,110,'#059669')}<text x="40" y="566" font-size="13">Includes repeat installs, upgrades and automation. Not unique users or successful installs.</text><text x="40" y="587" font-size="12">Last valid snapshot retained if data collection fails. Historical counts may be revised by npm.</text></g></svg>`;
}
async function json(url) {
  const r = await fetch(url, {signal:AbortSignal.timeout(30000)});
  if(!r.ok) throw new Error(`${r.status}: ${url}`);
  return r.json();
}
async function main() {
  const name='dsh-mcp-connector';
  const meta=await json(`https://registry.npmjs.org/${name}`);
  const start=meta.time.created.slice(0,10);
  const latest=await json(`https://api.npmjs.org/downloads/point/last-day/${name}`);
  const end=latest.end;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(end)||Date.parse(end)<Date.parse(start)) throw new Error('Invalid reporting range');
  const rows=[];
  for(let t=Date.parse(start);t<=Date.parse(end);t+=365*DAY) {
    const a=date(t),b=date(Math.min(t+364*DAY,Date.parse(end)));
    const data=await json(`https://api.npmjs.org/downloads/range/${a}:${b}/${name}`);
    if(data.package!==name||data.start!==a||data.end!==b)throw new Error('Unexpected API response');
    rows.push(...validateDays(data.downloads,a,b));
  }
  const svg=render(rows);
  const dir=new URL('../docs/metrics/',import.meta.url);
  await mkdir(dir,{recursive:true});
  // All network requests and validation finish before replacing the last valid artifacts.
  for(const [file,body] of [['npm-downloads.json',JSON.stringify({package:name,source:'https://api.npmjs.org',start,end,days:rows},null,2)+'\n'],['npm-downloads.svg',svg]]) {
    await writeFile(new URL(file+'.tmp',dir),body);await rename(new URL(file+'.tmp',dir),new URL(file,dir));
  }
  console.log(JSON.stringify({start,end,total:summarize(rows).total,last30:summarize(rows).last30}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await main();
