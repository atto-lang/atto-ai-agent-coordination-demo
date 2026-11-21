// Structural contract, NOT compiler-backed guest behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditActorSource } from '../scripts/actor-state-audit.mjs';
const native=readFileSync(new URL('../src/runtime/workflow_inbox_outbox.ores',import.meta.url),'utf8');
const sqlite=readFileSync(new URL('../reference/sqlite-supervisor.mjs',import.meta.url),'utf8');
const checker=readFileSync(new URL('../scripts/check-native-actors.mjs',import.meta.url),'utf8');
const aggregate=readFileSync(new URL('../scripts/run-native-acceptance.mjs',import.meta.url),'utf8');

test('native outbox has sealed, bounded, exclusive state transitions',()=>{
 const result=auditActorSource(native);
 assert.equal(result.actor,'WorkflowInboxOutboxActor');
 assert.deepEqual(result.problems,[]);
 assert.equal(result.fields,11);
 assert.equal(result.methods,6);
 assert.equal(result.writes,4);
 assert.equal(result.reads,2);
 assert.match(native,/s\.message_ids\.size >= 64/);
});
test('native inbox admission refuses message, step and effect-key replay',()=>{
 const start=native.indexOf('  pub accept_step(');
 const end=native.indexOf('  pub claim_dispatch(');
 const code=native.slice(start,end);
 for(const field of ['message_ids','step_ids','effect_keys']){
   assert.ok(code.includes('for (const prior of s.'+field+')'),field);
 }
 for(const field of ['tenant != s.tenant_id','run != s.run_id',
   'revision != s.source_revision','epoch != s.activation_epoch',
   'expected_version != s.version'])assert.ok(code.includes(field),field);
});
test('claim and reconciliation cannot dispatch or settle twice',()=>{
 const claim=native.slice(native.indexOf('  pub claim_dispatch('),native.indexOf('  pub reconcile('));
 const settle=native.slice(native.indexOf('  pub reconcile('),native.indexOf('  pub state_of('));
 assert.match(claim,/s\.states\[i\] == 0/);
 assert.match(claim,/s\.states\[i\] = 1/);
 assert.match(settle,/s\.states\[i\] == 1/);
 assert.match(settle,/s\.states\[i\] = 2/);
 assert.match(settle,/s\.states\[i\] = 3/);
 assert.match(settle,/previous == verified_receipt/);
 assert.doesNotMatch(native.replace(/^\/\/.*$/gm,''),/\b(?:await|spawn|stdio|fetch)\b/);
});
test('SQLite persistence does atomic inbox+outbox, one-time claim and separate receipt verification',()=>{
 for(const x of ['CREATE TABLE IF NOT EXISTS inbox','BEGIN IMMEDIATE',
   "state:'prepared'",'accept_step({','claim_dispatch({',
   "row.state==='prepared'",'state=\'in_doubt\'',
   'adapter.verify_receipt','effect changed during receipt verification',
   "UPDATE inbox SET state=?"])assert.ok(sqlite.includes(x),x);
 assert.ok(sqlite.indexOf('const verified=adapter.verify_receipt') <
   sqlite.indexOf("return this.#transaction(() => {",sqlite.indexOf('  reconcile(')));
});
test('full native source manifest includes six runtime actor files',()=>{
 assert.match(checker,/'src\/runtime': 6/);
 assert.match(aggregate,/\['src\/runtime',6\]/);
 assert.match(aggregate,/guest_scenarios:3/);
});
