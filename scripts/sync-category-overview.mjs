import {readFile,writeFile} from 'node:fs/promises';
const source=process.argv[2];
let block;
if(source)block=await readFile(source,'utf8');else{
 const r=await fetch('https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector-registry/main/docs/CATEGORY-OVERVIEW.md',{signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Category overview fetch failed: '+r.status);block=await r.text();
}
if(!block.startsWith('<!-- catalog-directory:start -->')||!block.includes('<!-- catalog-directory:end -->')||block.split('\n').filter(l=>/^\| .+ \| 公共 \d+＋内置 \d+ \|/.test(l)).length!==9)throw Error('Invalid overview: expected nine category rows');
for(const name of ['README.md','README.en.md']){
 let s=await readFile(name,'utf8');s=s.replace(/<!-- catalog-directory:start -->[\s\S]*?<!-- catalog-directory:end -->\s*/,'');
 const anchor=name==='README.md'?'从持续更新的连接器目录':'Connect MCP servers from';
 if(!s.includes(anchor))throw Error('Product overview anchor missing');
 s=s.replace(anchor,block.trim()+'\n\n'+anchor);await writeFile(name,s);
}
