import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SqliteWorkflowSupervisor } from '../reference/sqlite-supervisor.mjs';
import { WorkflowCapabilityIssuer, WorkflowCapabilityVerifier } from '../reference/workflow-capabilities.mjs';

const signingKey=Buffer.alloc(32,0x72); // TEST-ONLY, NEVER DEPLOY
const mint=(action,scope)=>new WorkflowCapabilityIssuer(signingKey).issue(action,scope,Date.now()+60000);
function openDb(directory) {
  const db=new SqliteWorkflowSupervisor(directory,new WorkflowCapabilityVerifier(signingKey));
  // This helper simulates an authenticated controller ONLY in these tests.
  // Production callers must not be able to mint tokens or call activate.
  return new Proxy(db,{get(target,property) {
    if (property==='inspect') return (tenant,run)=>
      target.inspect(tenant,run,revision,mint('inspect',{tenant,run,revision}));
    if (property==='create_run') return (tenant,run,revision)=>
      target.create_run(tenant,run,revision,mint('create_run',{tenant,run,revision}));
    if (property==='activate') return (tenant,run,revision)=>{
      const epoch=target.inspect(tenant,run,revision,mint('inspect',{tenant,run,revision}))?.workflow.epoch ?? -1;
      return target.activate(tenant,run,revision,epoch,mint('activate',{tenant,run,revision,epoch}));
    };
    if (property==='prepare_effect') return input=>
      target.prepare_effect(input,mint('prepare_effect',input));
    if (property==='reconcile') return (input,adapter)=>
      target.reconcile(input,adapter,mint('reconcile',input));
    if (property==='finish') return input=>target.finish(input,mint('finish',input));
    const value=Reflect.get(target,property,target);
    return typeof value==='function' ? value.bind(target):value;
  }});
}
const revision = 'a'.repeat(40), digest = createHash('sha256').update('effect').digest('hex');
const root = () => mkdtempSync(join(tmpdir(),'ores-supervisor-'));
const runInfo = (db,tenant='tenant-a',run='run-1') => db.inspect(tenant,run).workflow;
const trusted = (key='step-key',receipt='remote-001',decision='committed') => ({
  verify_receipt: ({key:k,digest:d,receipt:r,decision:s}) =>
    k===key && d===digest && r===receipt && s===decision
});

test('SQLite WAL prepares effects durably and fences stale activation epochs',()=>{
 const dir=root(), db=openDb(dir);
 db.create_run('tenant-a','run-1',revision);
 const a=db.activate('tenant-a','run-1',revision);
 db.prepare_effect({tenant:'tenant-a',run:'run-1',revision,epoch:a.epoch,version:a.version,
   step:'step-1',key:'step-key',digest});
 db.close();
 const reopened=openDb(dir);
 assert.equal(reopened.inspect('tenant-a','run-1').effects[0].state,'in_doubt');
 const b=reopened.activate('tenant-a','run-1',revision);
 assert.equal(b.epoch,a.epoch+1);
 assert.throws(()=>reopened.reconcile({tenant:'tenant-a',run:'run-1',revision,epoch:a.epoch,
   version:b.version,step:'step-1',decision:'committed',receipt:'remote-001'},trusted()),/stale generation/);
 assert.equal(reopened.reconcile({tenant:'tenant-a',run:'run-1',revision,epoch:b.epoch,
   version:b.version,step:'step-1',decision:'committed',receipt:'remote-001'},trusted()).state,'committed');
 reopened.finish({tenant:'tenant-a',run:'run-1',revision,
   epoch:b.epoch,version:b.version+1});
 assert.equal(runInfo(reopened).phase,'finished');
 reopened.close();
});

test('rejects duplicate keys, stale version, cross-tenant access and forged receipts',()=>{
 const db=openDb(root());
 db.create_run('tenant-a','run-1',revision);
 db.create_run('tenant-b','run-2',revision);
 const a=db.activate('tenant-a','run-1',revision);
 db.prepare_effect({tenant:'tenant-a',run:'run-1',revision,epoch:a.epoch,version:a.version,
   step:'step-1',key:'step-key',digest});
 assert.throws(()=>db.prepare_effect({tenant:'tenant-a',run:'run-1',revision,
   epoch:a.epoch,version:a.version,step:'step-2',key:'other-key',digest}),/stale generation/);
 const n=runInfo(db);
 assert.throws(()=>db.prepare_effect({tenant:'tenant-a',run:'run-1',revision,
   epoch:a.epoch,version:n.version,step:'step-2',key:'step-key',digest}),/UNIQUE constraint/);
 assert.throws(()=>db.reconcile({tenant:'tenant-a',run:'run-1',revision,
   epoch:a.epoch,version:n.version,step:'step-1',decision:'committed',receipt:'remote-001'},
   {verify_receipt:()=>false}),/unverified remote receipt/);
 assert.throws(()=>db.reconcile({tenant:'tenant-b',run:'run-1',revision,
   epoch:a.epoch,version:n.version,step:'step-1',decision:'committed',receipt:'remote-001'},trusted()),/stale generation/);
 assert.equal(db.inspect('tenant-a','run-1').effects[0].state,'in_doubt');
 assert.throws(()=>db.finish({tenant:'tenant-a',run:'run-1',revision,
   epoch:a.epoch,version:n.version}),/unfinished or uncertain/);
 db.close();
});

test('a verified NOT_APPLIED outcome never masquerades as completed',()=>{
 const db=openDb(root());
 db.create_run('tenant-a','run-1',revision);
 const a=db.activate('tenant-a','run-1',revision);
 db.prepare_effect({tenant:'tenant-a',run:'run-1',revision,epoch:a.epoch,
   version:a.version,step:'step-1',key:'step-key',digest});
 const version=runInfo(db).version;
 db.reconcile({tenant:'tenant-a',run:'run-1',revision,epoch:a.epoch,
   version,step:'step-1',decision:'not_applied',receipt:'remote-001'},trusted('step-key','remote-001','not_applied'));
 assert.equal(db.inspect('tenant-a','run-1').effects[0].state,'not_applied');
 assert.throws(()=>db.finish({tenant:'tenant-a',run:'run-1',revision,
   epoch:a.epoch,version:version+1}),/unfinished or uncertain/);
 db.close();
});

test('SIGKILL AFTER simulated external commit BEFORE local acknowledgment: no duplicate effect',()=>{
 const dir=root(), remote=join(dir,'remote-receipt.json');
 const moduleUrl=new URL('../reference/sqlite-supervisor.mjs',import.meta.url).href;
 const authUrl=new URL('../reference/workflow-capabilities.mjs',import.meta.url).href;
 const script=`import { SqliteWorkflowSupervisor } from ${JSON.stringify(moduleUrl)};
import { WorkflowCapabilityIssuer, WorkflowCapabilityVerifier } from ${JSON.stringify(authUrl)};
import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
const key=Buffer.alloc(32,0x72), issuer=new WorkflowCapabilityIssuer(key);
const grant=(action,scope)=>issuer.issue(action,scope,Date.now()+60000);
const s=new SqliteWorkflowSupervisor(${JSON.stringify(dir)},new WorkflowCapabilityVerifier(key));
s.create_run('tenant-a','run-1','${revision}',grant('create_run',{tenant:'tenant-a',run:'run-1',revision:'${revision}'}));
const lease=s.activate('tenant-a','run-1','${revision}',0,grant('activate',{tenant:'tenant-a',run:'run-1',revision:'${revision}',epoch:0}));
s.prepare_effect({tenant:'tenant-a',run:'run-1',revision:'${revision}',
 epoch:lease.epoch,version:lease.version,step:'step-1',key:'step-key',digest:'${digest}'},
 grant('prepare_effect',{tenant:'tenant-a',run:'run-1',revision:'${revision}',epoch:lease.epoch,version:lease.version,step:'step-1',key:'step-key',digest:'${digest}'}));
const fd=openSync(${JSON.stringify(remote)},'wx',0o600);
try{const data=Buffer.from(JSON.stringify({key:'step-key',digest:'${digest}',receipt:'remote-001',count:1}));
 writeSync(fd,data);fsyncSync(fd);}finally{closeSync(fd);}
process.kill(process.pid,'SIGKILL');`;
 const killed=spawnSync(process.execPath,['--no-warnings','--input-type=module','-e',script],
   {encoding:'utf8',timeout:6000});
 assert.equal(killed.signal,'SIGKILL',killed.stderr);
 const externalBefore=readFileSync(remote,'utf8');
 const recovered=openDb(dir);
 assert.equal(recovered.inspect('tenant-a','run-1').effects[0].state,'in_doubt');
 const lease=recovered.activate('tenant-a','run-1',revision);
 const adapter={verify_receipt:({key,digest:expected,receipt,decision})=>{
   const authority=JSON.parse(readFileSync(remote,'utf8'));
   return decision==='committed' && key===authority.key && expected===authority.digest &&
     receipt===authority.receipt;
 }};
 recovered.reconcile({tenant:'tenant-a',run:'run-1',revision,epoch:lease.epoch,
   version:lease.version,step:'step-1',decision:'committed',receipt:'remote-001'},adapter);
 recovered.finish({tenant:'tenant-a',run:'run-1',revision,epoch:lease.epoch,
   version:lease.version+1});
 assert.equal(recovered.inspect('tenant-a','run-1').workflow.phase,'finished');
 assert.equal(JSON.parse(readFileSync(remote,'utf8')).count,1);
 assert.equal(readFileSync(remote,'utf8'),externalBefore);
 recovered.close();
});

test('duplicate remote receipt cannot settle two different step keys',()=>{
 const db=openDb(root());
 db.create_run('tenant-a','run-1',revision);
 const a=db.activate('tenant-a','run-1',revision);
 db.prepare_effect({tenant:'tenant-a',run:'run-1',revision,epoch:a.epoch,
   version:a.version,step:'step-1',key:'step-key',digest});
 let v=runInfo(db).version;
 db.prepare_effect({tenant:'tenant-a',run:'run-1',revision,epoch:a.epoch,
   version:v,step:'step-2',key:'different-key',digest});
 v=runInfo(db).version;
 db.reconcile({tenant:'tenant-a',run:'run-1',revision,epoch:a.epoch,
   version:v,step:'step-1',decision:'committed',receipt:'remote-001'},trusted());
 v=runInfo(db).version;
 assert.throws(()=>db.reconcile({tenant:'tenant-a',run:'run-1',revision,epoch:a.epoch,
   version:v,step:'step-2',decision:'committed',receipt:'remote-001'},
   {verify_receipt:()=>true}),/UNIQUE constraint/);
 assert.equal(db.inspect('tenant-a','run-1').effects[1].state,'in_doubt');
 db.close();
});
