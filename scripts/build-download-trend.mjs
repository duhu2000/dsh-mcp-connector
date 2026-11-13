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
  const max = Math.max(1, Math.ceil(s.total / 10000) * 10000);
  const points = s.cumulative;
  const path = points.map((p,i) => `${i?'L':'M'}${100+i*820/Math.max(1,points.length-1)},${420-p.value/max*230}`).join(' ');
  const grid = [0,.25,.5,.75,1].map(f=>`<path d="M100 ${420-230*f} H920" stroke="#dce4f0"/><text x="88" y="${425-230*f}" text-anchor="end" font-size="15">${fmt(Math.round(max*f))}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600" role="img" aria-labelledby="title desc"><title id="title">MCP连接器 · npm 累计下载趋势</title><desc id="desc">${rows[0].day} 至 ${rows.at(-1).day} 累计 ${fmt(s.total)} 次下载；不等于独立用户数或成功安装数。</desc><rect width="1000" height="600" rx="18" fill="#f6f9ff"/><g font-family="Noto Sans CJK SC, Arial Unicode MS, sans-serif" fill="#334155"><text x="40" y="48" font-size="27" font-weight="bold">MCP连接器 · npm 累计下载趋势</text><text x="40" y="82" font-size="16">dsh-mcp-connector</text><text x="40" y="130" font-size="32" font-weight="bold" fill="#4f46e5">累计下载 ${fmt(s.total)} 次</text><text x="40" y="162" font-size="16">统计区间：${rows[0].day} — ${rows.at(-1).day}（UTC）</text>${grid}<path d="${path}" stroke="#4f46e5" stroke-width="3" fill="none"/><text x="100" y="449" font-size="15">${rows[0].day}</text><text x="920" y="449" text-anchor="end" font-size="15">${rows.at(-1).day}</text><text x="40" y="491" font-size="16">数据来源：npm 官方下载统计接口；累计值为上述区间每日下载次数之和。</text><text x="40" y="523" font-size="16">包含升级、重复安装及自动化下载，不等于独立用户数、成功安装数或连接器调用量。</text><text x="40" y="555" font-size="16">累计上升不代表近期增速上升。历史数据可能由 npm 修订。</text><text x="40" y="582" font-size="14">数据更新失败时保留上次有效快照；请以图中截止日期为准。</text></g></svg>`;
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
