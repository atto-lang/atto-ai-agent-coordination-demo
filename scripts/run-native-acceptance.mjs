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
let nativeCheck = null;
let guestCheck = null;
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
      nativeCheck = verifyNativeCheck(report, demo, process.env.ORESLANG_COMPILER_SHA);
    } else if (script === 'run-native-guest.mjs') {
      const report = receiptFromOutput(result.stdout, 'NATIVE_GUEST_RESULT');
      guestCheck = verifyNativeGuest(report, demo, process.env.ORESLANG_COMPILER_SHA);
    } else {
      fail('unexpected native acceptance gate');
    }
  } catch (error) {
    fail('invalid native evidence for ' + script + ': ' + String(error.message));
  }
}
if (!nativeCheck || !guestCheck || nativeCheck.checked_actors < 20 ||
    nativeCheck.checked_guest_sources !== 2 ||
    nativeCheck.negative_native_checks !== 1 ||
    guestCheck.guest_scenarios !== 2)
  fail('native acceptance incomplete');

console.log('NATIVE_ACCEPTANCE_RESULT ' + JSON.stringify({demo_head:head,
  demo_tree:tree, checked_actors:nativeCheck.checked_actors,
  positive_native_checks:nativeCheck.positive_native_checks,
  negative_native_checks:nativeCheck.negative_native_checks,
  checked_guest_sources:nativeCheck.checked_guest_sources,
  native_manifest_sha256:nativeCheck.manifest_sha256,
  guest_scenarios:guestCheck.guest_scenarios,
  verified_guest_hashes:guestCheck.verified_guest_hashes, passed:true,
  scope:'Java positive and negative checks plus two guest stdout oracles; no crash recovery'}));
