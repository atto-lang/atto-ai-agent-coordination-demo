import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowCapabilityIssuer,WorkflowCapabilityVerifier} from '../reference/workflow-capabilities.mjs';
import {SqliteWorkflowSupervisor} from '../reference/sqlite-supervisor.mjs';
const key=Buffer.alloc(32,0xb3), issuer=new WorkflowCapabilityIssuer(key), verifier=new WorkflowCapabilityVerifier(key);
const revision='a'.repeat(40), scope={tenant:'tenant-a',run:'run-1',revision};
const valid=(action,sc)=>issuer.issue(action,sc,Date.now()+60000);
const root=()=>mkdtempSync(join(tmpdir(),'ores-secure-'));

test('separate OS processes cannot both activate with same signed epoch capability',async()=>{
 const {spawn}=await import('node:child_process');
 const dir=root();
 const seed=new SqliteWorkflowSupervisor(dir,verifier);
 seed.create_run(scope.tenant,scope.run,scope.revision,valid('create_run',scope));
 seed.close();
 const dbUrl=new URL('../reference/sqlite-supervisor.mjs',import.meta.url).href;
 const authUrl=new URL('../reference/workflow-capabilities.mjs',import.meta.url).href;
 const token=valid('activate',{...scope,epoch:0});
 const child=`import {SqliteWorkflowSupervisor} from ${JSON.stringify(dbUrl)};
import {WorkflowCapabilityVerifier} from ${JSON.stringify(authUrl)};
const db=new SqliteWorkflowSupervisor(${JSON.stringify(dir)},new WorkflowCapabilityVerifier(Buffer.alloc(32,0xb3)));
try {db.activate('tenant-a','run-1','${revision}',0,${JSON.stringify(token)});db.close();process.stdout.write('activated');}
catch(e){db.close();process.stdout.write('fenced');process.exitCode=7;}`;
 const spawnOnce=()=>new Promise((resolve,reject)=>{
   const p=spawn(process.execPath,['--no-warnings','--input-type=module','-e',child],{stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';p.stdout.on('data',c=>stdout+=c);p.stderr.on('data',c=>stderr+=c);
   p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));
 });
 const outcomes=await Promise.all([spawnOnce(),spawnOnce()]);
 assert.deepEqual(outcomes.map(x=>x.code).sort(),[0,7],JSON.stringify(outcomes));
 assert.deepEqual(outcomes.map(x=>x.stdout).sort(),['activated','fenced']);
 const inspect=new SqliteWorkflowSupervisor(dir,verifier);
 assert.equal(inspect.inspect(scope.tenant,scope.run,scope.revision,valid('inspect',scope)).workflow.epoch,1);
 inspect.close();
});
