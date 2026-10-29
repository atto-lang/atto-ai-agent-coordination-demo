import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, openSync, writeSync, closeSync, fsyncSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { SqliteWorkflowSupervisor } from '../reference/sqlite-supervisor.mjs';
import { WorkflowCapabilityIssuer, WorkflowCapabilityVerifier } from '../reference/workflow-capabilities.mjs';
const key=Buffer.alloc(32,0x4f); // test-only, never a deployment secret
const issuer=new WorkflowCapabilityIssuer(key), verifier=new WorkflowCapabilityVerifier(key);
const revision='a'.repeat(40), digest='b'.repeat(64), tenant='tenant-a', run='run-1';
const directory=()=>mkdtempSync(join(tmpdir(),'ores-outbox-'));
const scope={tenant,run,revision};
const grant=(action,claims)=>issuer.issue(action,claims,Date.now()+60_000);
const open=dir=>new SqliteWorkflowSupervisor(dir,verifier);
const inspect=db=>db.inspect(tenant,run,revision,grant('inspect',scope));
function seed(dir){
 const db=open(dir);
 db.create_run(tenant,run,revision,grant('create_run',scope));
 const lease=db.activate(tenant,run,revision,0,grant('activate',{...scope,epoch:0}));
 return {db,lease};
}
function accept(db,epoch,version,step='step-1',message_id='m-1',effectKey='key-1'){
 const request={...scope,epoch,version,step,message_id,key:effectKey,digest};
 return db.accept_step(request,grant('accept_step',request));
}
function claim(db,epoch,version,step='step-1',effectKey='key-1'){
 const request={...scope,epoch,version,step,key:effectKey,digest};
 return db.claim_dispatch(request,grant('claim_dispatch',request));
}
function verify(db,epoch,version,receipt='receipt-1',decision='committed',check=()=>true){
 const request={...scope,epoch,version,step:'step-1',decision,receipt};
 return db.reconcile(request,{verify_receipt:check},grant('reconcile',request));
}

test('inbox and prepared outbox are one transaction with unique message, step and key',()=>{
 const {db,lease}=seed(directory());
 const prepared=accept(db,lease.epoch,lease.version);
 assert.equal(prepared.state,'prepared');
 const snap=inspect(db);
 assert.equal(snap.inbox.length,1);
 assert.equal(snap.inbox[0].message_id,'m-1');
 assert.equal(snap.inbox[0].state,'accepted');
 assert.equal(snap.effects[0].state,'prepared');
 assert.equal(snap.workflow.version,lease.version+1);
 assert.throws(()=>accept(db,lease.epoch,snap.workflow.version,'step-2','m-1','key-2'),/UNIQUE/);
 assert.throws(()=>accept(db,lease.epoch,snap.workflow.version,'step-1','m-2','key-2'),/UNIQUE/);
 assert.throws(()=>accept(db,lease.epoch,snap.workflow.version,'step-2','m-2','key-1'),/UNIQUE/);
 assert.equal(inspect(db).workflow.version,prepared.version);
 assert.equal(inspect(db).effects.length,1);
 assert.equal(inspect(db).inbox.length,1);
 db.close();
});

test('durable dispatch claim is single-use and in-doubt blocks finish and redispatch',()=>{
 const dir=directory(),{db,lease}=seed(dir);
 const prepared=accept(db,lease.epoch,lease.version);
 assert.throws(()=>verify(db,lease.epoch,prepared.version),/effect not in doubt/);
 const claimed=claim(db,lease.epoch,prepared.version);
 assert.equal(claimed.state,'in_doubt');
 assert.throws(()=>claim(db,lease.epoch,claimed.version),/already claimed/);
 assert.throws(()=>db.finish({...scope,epoch:lease.epoch,version:claimed.version},
   grant('finish',{...scope,epoch:lease.epoch,version:claimed.version})),/unfinished or uncertain/);
 db.close();
 const reopened=open(dir);
 assert.equal(inspect(reopened).effects[0].state,'in_doubt');
 const next=reopened.activate(tenant,run,revision,lease.epoch,
   grant('activate',{...scope,epoch:lease.epoch}));
 assert.throws(()=>claim(reopened,next.epoch,next.version),/already claimed/);
 assert.throws(()=>claim(reopened,lease.epoch,next.version),/stale/);
 reopened.close();
});

test('reconcile is fenced by exact effect key and digest, and resolves inbox atomically',()=>{
 const {db,lease}=seed(directory());
 let v=accept(db,lease.epoch,lease.version).version;
 v=claim(db,lease.epoch,v).version;
 assert.throws(()=>verify(db,lease.epoch,v,'receipt-1','committed',()=>false),/unverified/);
 assert.equal(inspect(db).inbox[0].state,'accepted');
 const done=verify(db,lease.epoch,v,'receipt-1','committed',({key,digest:d,decision,receipt})=>
   key==='key-1' && d===digest && decision==='committed' && receipt==='receipt-1');
 assert.equal(done.state,'committed');
 const snap=inspect(db);
 assert.equal(snap.inbox[0].state,'committed');
 assert.equal(snap.effects[0].state,'committed');
 assert.equal(snap.workflow.version,done.version);
 assert.throws(()=>verify(db,lease.epoch,done.version),/effect not in doubt/);
 db.finish({...scope,epoch:lease.epoch,version:done.version},
   grant('finish',{...scope,epoch:lease.epoch,version:done.version}));
 assert.equal(inspect(db).workflow.phase,'finished');
 db.close();
});

test('SIGKILL after durable claim but before dispatch leaves forever in-doubt, never autoredispatches',()=>{
 const dir=directory();
 const src=new URL('../reference/sqlite-supervisor.mjs',import.meta.url).href;
 const cap=new URL('../reference/workflow-capabilities.mjs',import.meta.url).href;
 const code=`import {SqliteWorkflowSupervisor} from ${JSON.stringify(src)};
import {WorkflowCapabilityIssuer,WorkflowCapabilityVerifier} from ${JSON.stringify(cap)};
const key=Buffer.alloc(32,0x4f), issuer=new WorkflowCapabilityIssuer(key);
const grant=(a,s)=>issuer.issue(a,s,Date.now()+60000);
const db=new SqliteWorkflowSupervisor(${JSON.stringify(dir)},new WorkflowCapabilityVerifier(key));
const scope={tenant:'tenant-a',run:'run-1',revision:'${revision}'};
db.create_run(scope.tenant,scope.run,scope.revision,grant('create_run',scope));
const lease=db.activate(scope.tenant,scope.run,scope.revision,0,grant('activate',{...scope,epoch:0}));
const admitted={...scope,epoch:lease.epoch,version:lease.version,step:'step-1',message_id:'m-1',key:'key-1',digest:'${digest}'};
db.accept_step(admitted,grant('accept_step',admitted));
const claim={...scope,epoch:lease.epoch,version:lease.version+1,step:'step-1',key:'key-1',digest:'${digest}'};
db.claim_dispatch(claim,grant('claim_dispatch',claim));
process.kill(process.pid,'SIGKILL');`;
 const killed=spawnSync(process.execPath,['--no-warnings','--input-type=module','-e',code],{encoding:'utf8',timeout:7000});
 assert.equal(killed.signal,'SIGKILL',killed.stderr);
 const recovered=open(dir),original=inspect(recovered);
 assert.equal(original.effects[0].state,'in_doubt');
 assert.equal(original.inbox[0].state,'accepted');
 const newLease=recovered.activate(tenant,run,revision,original.workflow.epoch,
   grant('activate',{...scope,epoch:original.workflow.epoch}));
 assert.throws(()=>claim(recovered,newLease.epoch,newLease.version),/already claimed/);
 assert.equal(inspect(recovered).effects[0].state,'in_doubt');
 recovered.close();
});

test('SIGKILL after simulated remote effect, recovery verifies receipt without repeating external operation',()=>{
 const dir=directory(),remote=join(dir,'external-receipt.json');
 const src=new URL('../reference/sqlite-supervisor.mjs',import.meta.url).href;
 const cap=new URL('../reference/workflow-capabilities.mjs',import.meta.url).href;
 const code=`import {SqliteWorkflowSupervisor} from ${JSON.stringify(src)};
import {WorkflowCapabilityIssuer,WorkflowCapabilityVerifier} from ${JSON.stringify(cap)};
import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
const key=Buffer.alloc(32,0x4f), issuer=new WorkflowCapabilityIssuer(key);
const grant=(a,s)=>issuer.issue(a,s,Date.now()+60000);
const db=new SqliteWorkflowSupervisor(${JSON.stringify(dir)},new WorkflowCapabilityVerifier(key));
const scope={tenant:'tenant-a',run:'run-1',revision:'${revision}'};
db.create_run(scope.tenant,scope.run,scope.revision,grant('create_run',scope));
const lease=db.activate(scope.tenant,scope.run,scope.revision,0,grant('activate',{...scope,epoch:0}));
const admitted={...scope,epoch:lease.epoch,version:lease.version,step:'step-1',message_id:'m-1',key:'key-1',digest:'${digest}'};
db.accept_step(admitted,grant('accept_step',admitted));
const claim={...scope,epoch:lease.epoch,version:lease.version+1,step:'step-1',key:'key-1',digest:'${digest}'};
db.claim_dispatch(claim,grant('claim_dispatch',claim));
const fd=openSync(${JSON.stringify(remote)},'wx',0o600);
try {const b=Buffer.from(JSON.stringify({key:'key-1',digest:'${digest}',receipt:'receipt-1',count:1}));writeSync(fd,b);fsyncSync(fd);}finally{closeSync(fd);}
process.kill(process.pid,'SIGKILL');`;
 const killed=spawnSync(process.execPath,['--no-warnings','--input-type=module','-e',code],{encoding:'utf8',timeout:7000});
 assert.equal(killed.signal,'SIGKILL',killed.stderr);
 const remoteBefore=readFileSync(remote,'utf8');
 const recovered=open(dir),snapshot=inspect(recovered);
 assert.equal(snapshot.effects[0].state,'in_doubt');
 const next=recovered.activate(tenant,run,revision,snapshot.workflow.epoch,
   grant('activate',{...scope,epoch:snapshot.workflow.epoch}));
 const adapter={verify_receipt:({key,digest:d,decision,receipt})=>{
   const signedFixture=JSON.parse(readFileSync(remote,'utf8'));
   return key===signedFixture.key && d===signedFixture.digest && receipt===signedFixture.receipt && decision==='committed';
 }};
 const result=verify(recovered,next.epoch,next.version,'receipt-1','committed',adapter.verify_receipt);
 recovered.finish({...scope,epoch:next.epoch,version:result.version},
   grant('finish',{...scope,epoch:next.epoch,version:result.version}));
 assert.equal(inspect(recovered).inbox[0].state,'committed');
 assert.equal(inspect(recovered).workflow.phase,'finished');
 assert.equal(JSON.parse(readFileSync(remote,'utf8')).count,1);
 assert.equal(readFileSync(remote,'utf8'),remoteBefore);
 recovered.close();
});

test('two worker processes cannot both claim a prepared outbox command',async()=>{
 const dir=directory(),{db,lease}=seed(dir);
 const v=accept(db,lease.epoch,lease.version).version;
 db.close();
 const src=new URL('../reference/sqlite-supervisor.mjs',import.meta.url).href;
 const cap=new URL('../reference/workflow-capabilities.mjs',import.meta.url).href;
 const request={...scope,epoch:lease.epoch,version:v,step:'step-1',key:'key-1',digest};
 const token=grant('claim_dispatch',request);
 const code=`import {SqliteWorkflowSupervisor} from ${JSON.stringify(src)};
import {WorkflowCapabilityVerifier} from ${JSON.stringify(cap)};
const db=new SqliteWorkflowSupervisor(${JSON.stringify(dir)},new WorkflowCapabilityVerifier(Buffer.alloc(32,0x4f)));
try {db.claim_dispatch(${JSON.stringify(request)},${JSON.stringify(token)});db.close();process.stdout.write('claimed');}
catch(e){db.close();process.stdout.write('fenced');process.exitCode=7;}`;
 const run=()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--no-warnings','--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  child.on('error',reject);child.on('close',status=>resolve({status,stdout,stderr}));
 });
 const outcomes=await Promise.all([run(),run()]);
 assert.deepEqual(outcomes.map(x=>x.status).sort(),[0,7],JSON.stringify(outcomes));
 assert.deepEqual(outcomes.map(x=>x.stdout).sort(),['claimed','fenced']);
 const reopened=open(dir);
 assert.equal(inspect(reopened).effects[0].state,'in_doubt');
 assert.equal(inspect(reopened).workflow.version,v+1);
 reopened.close();
});

test('receipt verifier runs outside write transaction and a concurrent activation fences stale settlement',()=>{
 const {db,lease}=seed(directory());
 let v=accept(db,lease.epoch,lease.version).version;
 v=claim(db,lease.epoch,v).version;
 let called=false;
 assert.throws(()=>verify(db,lease.epoch,v,'receipt-1','committed',()=>{
   called=true;
   // A trusted controller may fence the actor while external verification
   // is happening. Reconciliation must re-check the original epoch/CAS.
   db.activate(tenant,run,revision,lease.epoch,
     grant('activate',{...scope,epoch:lease.epoch}));
   return true;
 }),/stale generation/);
 assert.equal(called,true);
 assert.equal(inspect(db).effects[0].state,'in_doubt');
 assert.equal(inspect(db).inbox[0].state,'accepted');
 const current=inspect(db).workflow;
 verify(db,current.epoch,current.version,'receipt-1','committed',()=>true);
 assert.equal(inspect(db).effects[0].state,'committed');
 db.close();
});
