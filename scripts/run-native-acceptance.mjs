#!/usr/bin/env node
// One-command native acceptance sequence; aborts on any missing compiler gate.
// Does not claim persistence, supervisor recovery or multi-backend parity.
import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { receiptFromOutput, verifyNativeCheck, verifyNativeGuest } from './native-evidence.mjs';
const scripts = ['check-native-actors.mjs', 'run-native-guest.mjs'];
const demo = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const expected = process.env.ORESLANG_DEMO_SHA ?? '';
function fail(message) {
  console.error('NATIVE_ACCEPTANCE_UNVERIFIED ' + message);
  process.exit(2);
}
if (!/^[a-f0-9]{40}$/.test(expected)) fail('exact ORESLANG_DEMO_SHA required');
let head, tree, dirty;
try {
  const opt = { encoding:'utf8', timeout:10000, maxBuffer:1024*1024 };
  head = execFileSync('git',['-C',demo,'rev-parse','HEAD'],opt).trim();
  tree = execFileSync('git',['-C',demo,'rev-parse','HEAD^{tree}'],opt).trim();
  dirty = execFileSync('git',['-C',demo,'status','--porcelain','--untracked-files=no'],opt).trim();
} catch { fail('demo Git checkout unavailable'); }
if (head !== expected || dirty) fail('demo revision mismatch or dirty tracked source');
let checkedActors = 0;
let checkedGuestSources = 0;
let manifestSha = '';
let verifiedGuest = null;
for (const script of scripts) {
  const file = fileURLToPath(new URL(script, import.meta.url));
  const result = spawnSync(process.execPath, [file], {
    env: process.env, encoding: 'utf8', timeout: 360000,
    maxBuffer: 3*1024*1024, shell: false
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.signal || result.status !== 0) {
    console.error('NATIVE_ACCEPTANCE_UNVERIFIED gate=' + script);
    process.exit(1);
  }
  try {
    if (script === 'check-native-actors.mjs') {
      const report = receiptFromOutput(result.stdout, 'NATIVE_CHECK_RESULT');
      const valid = verifyNativeCheck(report, demo, process.env.ORESLANG_COMPILER_SHA);
      checkedActors = valid.checked_actors;
      checkedGuestSources = valid.checked_guest_sources;
      manifestSha = valid.manifest_sha256;
    } else if (script === 'run-native-guest.mjs') {
      const report = receiptFromOutput(result.stdout, 'NATIVE_GUEST_RESULT');
      verifiedGuest = verifyNativeGuest(report, demo, process.env.ORESLANG_COMPILER_SHA);
    } else {
      fail('unexpected native gate');
    }
  } catch (error) {
    fail('invalid ' + script + ' evidence: ' + String(error.message));
  }
}
if (!verifiedGuest || checkedActors < 20 || checkedGuestSources < 1)
  fail('native acceptance incomplete');

console.log('NATIVE_ACCEPTANCE_RESULT ' + JSON.stringify({demo_head:head,
  demo_tree:tree, checked_actors:checkedActors, checked_guest_sources:checkedGuestSources,
  manifest_sha256:manifestSha, guest_scenarios:verifiedGuest.guest_scenarios,
  guest_fixture_sha256:verifiedGuest.guest_fixture_sha256,
  guest_oracle_sha256:verifiedGuest.guest_oracle_sha256,
  passed:true,
  scope:'Java checks and one guest stdout; no crash recovery'}));
