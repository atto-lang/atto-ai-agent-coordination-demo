import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const runner = new URL('../scripts/check-native-actors.mjs', import.meta.url);
const source = readFileSync(runner, 'utf8');
test('checks all actor sources, both guests and negative type fixture', () => {
  for (const fragment of ["'src': 8", "'src/memory': 9", "'src/runtime': 4", "'tests/guest/agent_pipeline.ores'", "'tests/guest/direct_agent_hop.ores'", "'tests/guest/step_agent_flow.ores'"]) assert.ok(source.includes(fragment), fragment);
  assert.match(source, /readdirSync/);
  assert.match(source, /source_sha256/);
  assert.match(source, /manifest:files/);

  assert.match(source, /'dev\.oreslang\.launcher\.OresMain','--check',source/);
  assert.match(source, /outcomes\.length === files\.length/);
  assert.match(source, /negative\/wrong_actor_mail_type\.ores/);
  assert.match(source, /ActorRef\.send mailbox value/);
  assert.match(source, /negative\.passed/);
});
test('missing compiler identity fails closed with nonzero exit', () => {
  const env={...process.env};
  delete env.ORESLANG_COMPILER_SHA; delete env.ORESLANG_COMPILER_ROOT;
  const r=spawnSync(process.execPath,[runner.pathname],{env,encoding:'utf8',timeout:5000});
  assert.equal(r.status,2);
  assert.match(r.stderr,/NATIVE_CHECK_UNVERIFIED/);
  assert.doesNotMatch(r.stdout,/"passed":true/);
});
test('branch name cannot masquerade as source SHA', () => {
  const r=spawnSync(process.execPath,[runner.pathname],{
    env:{...process.env,ORESLANG_COMPILER_SHA:'main',ORESLANG_COMPILER_ROOT:'.'},
    encoding:'utf8',timeout:5000});
  assert.equal(r.status,2);
});
