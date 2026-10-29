#!/usr/bin/env node
// Compile-only gate for the eight native .ores actors plus both actor-mail fixtures.
// This executes the Java OresMain --check compiler, NOT guest actor behavior.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exact ten positive cases; the negative source check runs separately.
const files = [
  'src/agent_coordinator.ores', 'src/agent_registry.ores',
  'src/decision_gate.ores', 'src/decision_tree.ores',
  'src/evidence_ledger.ores', 'src/knowledge_cache.ores',
  'src/knowledge_graph.ores', 'src/workflow.ores',
  'tests/guest/agent_pipeline.ores',
  'tests/guest/direct_agent_hop.ores'
];
function fail(reason, code=2) {
  console.error('NATIVE_CHECK_UNVERIFIED ' + reason);
  process.exit(code);
}
const expected = process.env.ORESLANG_COMPILER_SHA ?? '';
const rootInput = process.env.ORESLANG_COMPILER_ROOT ?? '';
if (!/^[a-f0-9]{40}$/.test(expected) || !rootInput)
  fail('exact ORESLANG_COMPILER_SHA and ORESLANG_COMPILER_ROOT required');
let root;
try { root = realpathSync(resolve(rootInput)); }
catch { fail('compiler root unavailable'); }
const classes = join(root, 'target', 'classes');
const cpFile = join(root, 'target', 'runtime-classpath.txt');
if (!existsSync(classes) || !existsSync(cpFile))
  fail('missing built Java classes or runtime-classpath.txt');
const options = { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 };
let head, dirty;
try {
  head = execFileSync('git', ['-C',root,'rev-parse','HEAD'], options).trim();
  dirty = execFileSync('git', ['-C',root,'status','--porcelain','--untracked-files=no'],options).trim();
} catch { fail('compiler source identity unavailable'); }
if (head !== expected || dirty) fail('compiler SHA mismatch or dirty tracked source');
const cp = readFileSync(cpFile, 'utf8').trim();
if (!cp) fail('empty runtime classpath');
const java = process.env.ORESLANG_JAVA_BIN || 'java';
const base = fileURLToPath(new URL('../', import.meta.url));
const outcomes = [];
for (const file of files) {
  const source = join(base, file);
  if (!existsSync(source)) fail('missing native actor source: ' + file);
  const run = spawnSync(java, ['-cp',classes+delimiter+cp,
    'dev.oreslang.launcher.OresMain','--check',source],
  { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024*1024, shell: false });
  const passed = !run.error && run.status === 0 && !run.signal;
  outcomes.push({ file, passed, exit_code: run.status, signal: run.signal,
    stderr: (run.stderr || '').slice(-800) });
  if (!passed) break;
}
const positive_ok = outcomes.length === files.length && outcomes.every(x => x.passed);
let negative = null;
if (positive_ok) {
  const path = 'tests/guest/negative/wrong_actor_mail_type.ores';
  const source = join(base, path);
  if (!existsSync(source)) fail('missing negative type fixture');
  const run = spawnSync(java, ['-cp', classes + delimiter + cp,
    'dev.oreslang.launcher.OresMain', '--check', source], {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024*1024, shell: false
  });
  // A failure merely due to syntax, missing classes, or a runner exception
  // does NOT satisfy a negative type checker test.
  const diagnostic = String(run.stderr || '') + '\n' + String(run.stdout || '');
  negative = {
    file: path, exit_code: run.status, signal: run.signal,
    expected_type_error: 'ActorRef.send mailbox value',
    passed: !run.error && !run.signal && run.status !== null &&
      run.status !== 0 && diagnostic.includes('ActorRef.send mailbox value'),
    diagnostic: diagnostic.slice(-1000)
  };
}
const passed = positive_ok && Boolean(negative && negative.passed);
console.log('NATIVE_CHECK_RESULT ' + JSON.stringify({compiler_source_head:head,
  scope:'OresMain --check; ten positive source checks and one negative mailbox typing check; NOT guest execution',
  checked:outcomes.length, required:files.length, negative, passed, outcomes}));
if (!passed) fail('native compiler positive or negative check failed; see diagnostics',1);
