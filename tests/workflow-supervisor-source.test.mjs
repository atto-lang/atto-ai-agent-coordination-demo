// Structural verification of Oreslang supervisor + durable Node reference.
// Does NOT compile, execute or supervise any native Oreslang actor.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { auditActorSource } from '../scripts/actor-state-audit.mjs';

const native=readFileSync(new URL('../src/runtime/workflow_supervisor.ores',import.meta.url),'utf8');
const sqlite=readFileSync(new URL('../reference/sqlite-supervisor.mjs',import.meta.url),'utf8');
const testSource=readFileSync(new URL('./sqlite-supervisor.test.mjs',import.meta.url),'utf8');
const checker=readFileSync(new URL('../scripts/check-native-actors.mjs',import.meta.url),'utf8');
const gate=readFileSync(new URL('../scripts/run-native-acceptance.mjs',import.meta.url),'utf8');

test('supervisor actor uses sealed state and single-loan mutations',()=>{
 const result=auditActorSource(native);
 assert.equal(result.actor,'WorkflowSupervisorActor');
 assert.deepEqual(result.problems,[]);
 assert.equal(result.fields,11);
 assert.equal(result.methods,12);
 assert.equal(result.writes,9);
 assert.equal(result.reads,3);
});
test('each mutable transition has tenant/run/revision/generation/epoch/CAS fencing',()=>{
 const methods=['register_child','start_run','start_child','mark_child_unknown',
   'settle_child','fail_reconciled_child','complete_run','cancel_unstarted'];
 for(const name of methods){
  const start=native.indexOf('  pub '+name+'(');
  assert.ok(start>=0,name);
  const end=native.indexOf('  pub ',start+7);
  const code=native.slice(start,end>=0?end:undefined);
  for(const condition of ['tenant != s.tenant_id','run != s.run_id',
    'revision != s.source_revision','generation != s.generation',
    'epoch != s.activation_epoch','expected_version != s.version',
    's.version >= 2147483646'])
   assert.ok(code.includes(condition),name+' missing '+condition);
 }
});
test('cannot complete run unless every child has a verified receipt',()=>{
 const complete=native.slice(native.indexOf('  pub complete_run('),
   native.indexOf('  pub cancel_unstarted('));
 assert.match(complete,/s\.unresolved_count != 0/);
 assert.match(complete,/s\.child_ids\.size == 0/);
 assert.match(complete,/child_state != 2/);
 assert.match(complete,/s\.phase = 4/);
});
test('timeout freezes an in-flight child and limits receipt replay',()=>{
 assert.match(native,/s\.child_states\[i\] = 3/);
 assert.match(native,/s\.unresolved_count = s\.unresolved_count \+ 1/);
 assert.match(native,/s\.unresolved_count = s\.unresolved_count - 1/);
 assert.match(native,/s\.receipt_ids\.size >= 64/);
 assert.match(native,/previous == verified_receipt; then return false/);
 assert.match(native,/s\.child_ids\.size >= 64/);
 const cancel=native.slice(native.indexOf('  pub cancel_unstarted('),
   native.indexOf('  pub current_version('));
 assert.match(cancel,/s\.phase != 1/);
 assert.doesNotMatch(native.replace(/^\/\/.*$/gm,''),/\b(?:await|spawn|stdio|fetch)\b/);
});
test('experimental SQLite adapter requires WAL, full sync and durable in-doubt prepare',()=>{
 for(const token of ['journal_mode=WAL','synchronous=FULL','foreign_keys=ON',
   'BEGIN IMMEDIATE','epoch===epoch','state TEXT NOT NULL DEFAULT \'in_doubt\'',
   'effect_key TEXT NOT NULL UNIQUE','receipt TEXT UNIQUE'])
  assert.ok(sqlite.includes(token),token);
 assert.match(sqlite,/adapter\.verify_receipt/);
 assert.match(sqlite,/summary\.total===summary\.committed/);
});
test('real process-kill test and all native source manifests are present',()=>{
 assert.match(testSource,/process\.kill\(process\.pid,'SIGKILL'\)/);
 assert.match(testSource,/killed\.signal,'SIGKILL'/);
 assert.match(testSource,/remote-receipt\.json/);
 assert.match(checker,/'src\/runtime': 5/);
 assert.match(gate,/\['src\/runtime',5\]/);
 assert.match(gate,/guest_scenarios:3/);
});
