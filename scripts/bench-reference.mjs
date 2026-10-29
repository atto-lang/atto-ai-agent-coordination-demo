#!/usr/bin/env node
// Non-actor microbenchmark of JS Map vs queued JS reference requests.
// It DOES NOT measure Oreslang, distributed graphs, memory isolation, or GC.
import { performance } from 'node:perf_hooks';
const count=4096, samples=2000;
const data=new Map(Array.from({length:count},(_,i)=>['node-'+i, 'value-'+i]));
const seq=Array.from({length:samples},(_,i)=>(i*2377)%count);
const percentile=(arr,p)=>arr[Math.min(arr.length-1,Math.floor((arr.length-1)*p))];
const measure=async(name,run)=>{
 let digest=0;const durations=[];
 for(const n of seq.slice(0,200)) await run(n);
 for(const n of seq){const t=performance.now();const v=await run(n);durations.push((performance.now()-t)*1000);digest+=v.length;}
 durations.sort((a,b)=>a-b);
 return {name,queries:samples,checksum:digest,units:'microseconds',p50:percentile(durations,.50),p95:percentile(durations,.95),p99:percentile(durations,.99)};
};
const direct=await measure('direct-in-memory-map',async n=>data.get('node-'+n));
let pending=Promise.resolve();
const queued=await measure('serialized-javascript-queue',async n=>{
 const next=pending.then(()=>data.get('node-'+n));pending=next.then(()=>{});return next;
});
if(direct.checksum!==queued.checksum) throw Error('incorrect benchmark comparison');
console.log(JSON.stringify({scope:'JavaScript reference-only; not native Oreslang',node:process.version,results:[direct,queued]},null,2));
