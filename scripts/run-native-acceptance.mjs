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
let positiveNativeChecks = 0;
let negativeNativeChecks = 0;
let guestScenarios = 0;
let nativeManifest = [];
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
  const prefix = script === scripts[0] ? 'NATIVE_CHECK_RESULT ' : 'NATIVE_GUEST_RESULT ';
  const found = (result.stdout || '').split(/\r?\n/).filter(line => line.startsWith(prefix));
  if (found.length !== 1) fail('missing or duplicate native evidence receipt');
  let report;
  try { report = JSON.parse(found[0].slice(prefix.length)); }
  catch { fail('invalid native receipt JSON'); }
  if (report.passed !== true) fail('native evidence has no pass verdict');
  if (script === scripts[0]) {
    const names = ['tests/guest/agent_pipeline.ores','tests/guest/direct_agent_hop.ores'];
    if (!Array.isArray(report.manifest) || !Array.isArray(report.outcomes) ||
        report.checked !== report.required || report.checked !== report.manifest.length ||
        report.checked !== report.outcomes.length || report.checked < 22 ||
        report.negative?.passed !== true || report.negative?.exit_code === 0 ||
        report.negative?.file !== 'tests/guest/negative/wrong_actor_mail_type.ores' ||
        !names.every(name => report.manifest.includes(name)))
      fail('incomplete native compile checks');
    for (let i=0; i<report.checked; i++) {
      const outcome = report.outcomes[i];
      if (!outcome || outcome.file !== report.manifest[i] ||
          outcome.passed !== true || outcome.exit_code !== 0 || outcome.signal !== null)
        fail('failed or missing native file check');
    }
    nativeManifest = report.manifest;
    checkedActors = report.manifest.filter(name => name.startsWith('src/')).length;
    positiveNativeChecks = report.checked;
    negativeNativeChecks = 1;
    if (checkedActors < 20) fail('incomplete native actor coverage');
  } else {
    if (report.cases_required !== 2 || report.cases_executed !== 2 ||
        !Array.isArray(report.results) || report.results.length !== 2 ||
        report.results[0]?.name !== 'agent_pipeline' ||
        report.results[1]?.name !== 'direct_agent_hop' ||
        !report.results.every(r => r.passed === true && r.exit_code === 0 &&
          r.signal === null && r.stdout_exact === true))
      fail('incomplete native guest checks');
    guestScenarios = report.results.length;
  }
}

console.log('NATIVE_ACCEPTANCE_RESULT ' + JSON.stringify({demo_head:head,
  demo_tree:tree, checked_actors:checkedActors, positive_native_checks:positiveNativeChecks,
  negative_native_checks:negativeNativeChecks, guest_scenarios:guestScenarios,
  native_manifest_count:nativeManifest.length, passed:true,
  scope:'Java positive and negative checks plus two guest stdout oracles; no crash recovery'}));
