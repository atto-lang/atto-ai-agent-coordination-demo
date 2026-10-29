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
let checkedActors = 0;
let checkedGuestSources = 0;
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
  if (script === 'check-native-actors.mjs') {
    const lines = (result.stdout || '').split(/\r?\n/);
    const reports = lines.filter(x => x.startsWith('NATIVE_CHECK_RESULT '));
    if (reports.length !== 1) fail('missing or ambiguous compiler-check receipt');
    let report;
    try { report = JSON.parse(reports[0].slice('NATIVE_CHECK_RESULT '.length)); }
    catch { fail('invalid compiler-check receipt'); }
    if (report.passed !== true || !Number.isInteger(report.checked) ||
        report.checked < 21 || report.checked !== report.required ||
        !Array.isArray(report.manifest) ||
        report.manifest.length !== report.checked ||
        report.manifest.some(x => typeof x !== 'string') ||
        new Set(report.manifest).size !== report.manifest.length)
      fail('compiler-check receipt failed closed verification');
    checkedGuestSources = report.manifest.filter(x => x.startsWith('tests/guest/')).length;
    checkedActors = report.checked - checkedGuestSources;
    if (checkedActors < 20 || checkedGuestSources < 1)
      fail('insufficient native actor or guest source coverage');
  }
}
console.log('NATIVE_ACCEPTANCE_RESULT ' + JSON.stringify({demo_head:head,
  demo_tree:tree, checked_actors:checkedActors, checked_guest_sources:checkedGuestSources,
  guest_scenarios:1, passed:true,
  scope:'Java checks and one guest stdout; no crash recovery'}));
