import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateDays,summarize,render} from './build-download-trend.mjs';
test('reject gaps, duplicates and invalid counts without substituting zero',()=>{
 for(const rows of [[],[{day:'2026-01-01',downloads:-1}],[{day:'2026-01-01',downloads:1.5}],[{day:'2026-01-01',downloads:1},{day:'2026-01-01',downloads:2}]])assert.throws(()=>validateDays(rows,'2026-01-01','2026-01-02'));
});
test('sort dates and aggregate exact daily counts',()=>{
 const rows=validateDays([{day:'2026-01-02',downloads:3},{day:'2026-01-01',downloads:2}],'2026-01-01','2026-01-02');
 assert.equal(summarize(rows).total,5);assert.equal(summarize(rows).cumulative[1].value,5);
 assert.ok(!render(rows).includes('NaN'));
});
test('seven-day periods do not overlap',()=>{
 const rows=Array.from({length:90},(_,i)=>({day:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),downloads:1}));
 const s=summarize(rows);assert.equal(s.total,90);assert.equal(s.last30,30);assert.equal(s.weeks.length,12);assert.ok(s.weeks.every(w=>w.value===7));
});
