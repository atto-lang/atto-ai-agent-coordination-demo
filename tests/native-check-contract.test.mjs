import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const runner = new URL('../scripts/check-native-actors.mjs', import.meta.url);
const source = readFileSync(runner, 'utf8');
test('checks eight Oreslang classes and actor pipeline via real compiler --check', () => {
  assert.equal((source.match(/'src\/[a-z_]+\.ores'/g) || []).length, 8);
  assert.match(source, /'tests\/guest\/agent_pipeline\.ores'/);
  assert.match(source, /'dev\.oreslang\.launcher\.OresMain','--check',source/);
  assert.match(source, /outcomes\.length === files\.length/);
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
