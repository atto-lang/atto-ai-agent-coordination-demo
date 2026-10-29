import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const runner = new URL('../scripts/run-native-acceptance.mjs', import.meta.url);
const source = readFileSync(runner, 'utf8');
test('native acceptance chains compile checks before guest execution', () => {
  assert.match(source,/\['check-native-actors\.mjs', 'run-native-guest\.mjs'\]/);
  assert.match(source,/expected = process\.env\.ORESLANG_DEMO_SHA/);
  assert.match(source,/HEAD\^\{tree\}/);
  assert.match(source,/--untracked-files=no/);
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

test('full release marker requires structured evidence from all native sub-gates', () => {
  assert.match(source,/function requireEvidence\(script, output\)/);
  assert.match(source,/NATIVE_CHECK_RESULT /);
  assert.match(source,/NATIVE_GUEST_RESULT /);
  assert.match(source,/record\.compiler_source_head !== process\.env\.ORESLANG_COMPILER_SHA/);
  assert.match(source,/record\.checked !== 10/);
  assert.match(source,/record\.negative\?\.passed !== true/);
  assert.match(source,/record\.cases_executed !== 2/);
  assert.match(source,/x\.stdout_exact === true/);
  assert.match(source,/requireEvidence\(script, result\.stdout \|\| ''\)/);
});
