import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const runner = new URL('../scripts/run-native-acceptance.mjs', import.meta.url);
const source = readFileSync(runner, 'utf8');

test('native acceptance runs source checks, two actor-mail guests, then step guest', () => {
  assert.match(source, /'check-native-actors\.mjs', 'run-native-guest\.mjs', 'run-step-native-guest\.mjs'/);
  assert.match(source, /expected = process\.env\.ORESLANG_DEMO_SHA/);
  assert.match(source, /ORESLANG_COMPILER_SHA/);
  assert.match(source, /HEAD\^\{tree\}/);
  assert.match(source, /--untracked-files=no/);
  assert.match(source, /STEP_NATIVE_GUEST_RESULT /);
});

test('runner refuses absent exact demo Git revision', () => {
  const env={...process.env}; delete env.ORESLANG_DEMO_SHA;
  const r=spawnSync(process.execPath,[runner.pathname],{env,encoding:'utf8',timeout:5000});
  assert.equal(r.status,2);
  assert.match(r.stderr,/NATIVE_ACCEPTANCE_UNVERIFIED/);
  assert.doesNotMatch(r.stdout,/"passed":true/);
});

test('runner rejects symbolic demo refs', () => {
  const r=spawnSync(process.execPath,[runner.pathname],{
    env:{...process.env,ORESLANG_DEMO_SHA:'main'},encoding:'utf8',timeout:5000});
  assert.equal(r.status,2);
});

test('full release requires per-file source and oracle identity and actual guest exits', () => {
  assert.match(source, /function requireEvidence\(script, output\)/);
  assert.match(source, /NATIVE_CHECK_RESULT /);
  assert.match(source, /NATIVE_GUEST_RESULT /);
  assert.match(source, /STEP_NATIVE_GUEST_RESULT /);
  assert.match(source, /record\.compiler_source_head!==compiler/);
  assert.match(source, /record\.checked!==paths\.length/);
  assert.match(source, /record\.actor_count!==actorPaths\.length/);
  assert.match(source, /out\.source_sha256!==sha256\(paths\[i\]\)/);
  assert.match(source, /n\.expected_type_error!=='ActorRef\.send mailbox value'/);
  assert.match(source, /r\.source_sha256!==sha256\('tests\/guest\/'\+name\+'\.ores'\)/);
  assert.match(source, /r\.oracle_sha256!==sha256\('tests\/guest\/'\+name\+'\.stdout'\)/);
  assert.match(source, /r\.stdout_exact!==true/);
  assert.match(source, /r\.exit_code!==0/);
  assert.match(source, /guest_scenarios:3/);
  assert.match(source, /requireEvidence\(script,result\.stdout \|\| ''\)/);
});
