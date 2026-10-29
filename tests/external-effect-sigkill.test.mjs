import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DurableWorkflow,reconcile_pending} from '../reference/durable-workflow.mjs';
const sha='a'.repeat(40), digest=createHash('sha256').update('effect').digest('hex');

test('SIGKILL after simulated remote commit but before local ACK prevents duplicate effect',()=>{
 const d=mkdtempSync(join(tmpdir(),'ores-effect-'));
 const remote=join(d,'effect-receipt.json');
 const source=new URL('../reference/durable-workflow.mjs',import.meta.url).href;
 const code=`import { DurableWorkflow } from ${JSON.stringify(source)};
import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
const f=new DurableWorkflow(${JSON.stringify(d)},'workflow','${sha}');
f.begin();f.approve();f.intent('effect-1','${digest}');
// Simulated idempotent external tool: O_EXCL makes duplicate effects reject.
const fd=openSync(${JSON.stringify(remote)},'wx',0o600);
try { const buf=Buffer.from(JSON.stringify({key:'effect-1',digest:'${digest}',receipt:'remote-once',count:1}));writeSync(fd,buf);fsyncSync(fd); }
finally {closeSync(fd);}
process.kill(process.pid,'SIGKILL');`;
 const killed=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:5000});
 assert.equal(killed.signal,'SIGKILL',killed.stderr);
 const original=readFileSync(remote,'utf8');
 const reloaded=new DurableWorkflow(d,'workflow',sha);
 assert.equal(reloaded.state.intents['effect-1'].outcome,'pending');
 reconcile_pending(reloaded,{lookup:(key,expected)=>{
   const actual=JSON.parse(readFileSync(remote,'utf8'));
   assert.equal(actual.key,key);assert.equal(actual.digest,expected);
   return {status:'committed',receipt:actual.receipt};
 }});
 reloaded.finish();
 assert.equal(new DurableWorkflow(d,'workflow',sha).state.completed['effect-1'],'remote-once');
 assert.equal(readFileSync(remote,'utf8'),original);
 assert.equal(JSON.parse(original).count,1);
 assert.throws(()=>reloaded.intent('effect-1',digest),/effect not authorized/);
});
