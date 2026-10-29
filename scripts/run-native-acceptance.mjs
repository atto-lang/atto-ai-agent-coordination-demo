#!/usr/bin/env node
// One-command native acceptance sequence; aborts on any missing compiler gate.
// Does not claim persistence, supervisor recovery or multi-backend parity.
import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
function requireEvidence(script, output) {
  const marker = script === 'check-native-actors.mjs'
    ? 'NATIVE_CHECK_RESULT ' : 'NATIVE_GUEST_RESULT ';
  const matches = output.split('\\n').filter(line => line.startsWith(marker));
  if (matches.length !== 1) fail('missing or ambiguous evidence marker: ' + script);
  let record;
  try { record = JSON.parse(matches[0].slice(marker.length)); }
  catch { fail('invalid JSON evidence: ' + script); }
  if (record.passed !== true || record.compiler_source_head !== process.env.ORESLANG_COMPILER_SHA)
    fail('unverified compiler identity or failed result: ' + script);
  if (script === 'check-native-actors.mjs') {
    if (record.checked !== 10 || record.required !== 10 ||
        !Array.isArray(record.outcomes) || record.outcomes.length !== 10 ||
        !record.outcomes.every(x => x.passed === true) ||
        record.negative?.passed !== true)
      fail('incomplete positive or negative compiler checks');
  } else if (record.cases_required !== 2 || record.cases_executed !== 2 ||
      !Array.isArray(record.results) || record.results.length !== 2 ||
      !record.results.every(x => x.passed === true && x.stdout_exact === true))
      fail('incomplete actual guest execution');
}
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
  requireEvidence(script, result.stdout || '');
}
console.log('NATIVE_ACCEPTANCE_RESULT ' + JSON.stringify({demo_head:head,
  demo_tree:tree, checked_actors:8, positive_native_checks:10, negative_native_checks:1, guest_scenarios:2, passed:true,
  scope:'Java positive and negative checks plus two guest stdout oracles; no crash recovery'}));
