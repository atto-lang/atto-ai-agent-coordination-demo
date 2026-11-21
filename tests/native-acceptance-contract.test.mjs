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
  assert.match(source,/verifyNativeCheck/);
  assert.match(source,/verifyNativeGuest/);
  assert.match(source,/receiptFromOutput/);
  assert.match(source,/nativeCheck.negative_native_checks !== 1/);
  assert.match(source,/guestCheck.guest_scenarios !== 2/);
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

test('native evidence helper checks per-file and negative typecheck receipts', () => {
  const helper = readFileSync(new URL('../scripts/native-evidence.mjs', import.meta.url), 'utf8');
  for (const check of [
    'entry.passed !== true', 'entry.exit_code !== 0',
    'entry.signal !== null', 'SHA256.test(entry.source_sha256)',
    'neg.expected_type_error',
    'neg.diagnostic.includes(neg.expected_type_error)',
    'report.cases_executed !== 2',
    'entry.stdout_exact !== true',
    'sha256(readFileSync(path)) !== expected'
  ]) assert.ok(helper.includes(check), check);
});
