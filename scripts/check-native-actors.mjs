#!/usr/bin/env node
// Compile-only gate for every userland actor, three native guests and a negative mailbox fixture.
// This executes the Java OresMain --check compiler, NOT guest actor behavior.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const actorDirs = { 'src': 8, 'src/memory': 9, 'src/runtime': 4 };
const requiredGuestPaths = ['tests/guest/agent_pipeline.ores', 'tests/guest/direct_agent_hop.ores', 'tests/guest/step_agent_flow.ores'];
const negativePath = 'tests/guest/negative/wrong_actor_mail_type.ores';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function listActors(base, dir, minimum) {
  const location = join(base, dir);
  if (!existsSync(location)) fail('missing source directory: ' + dir);
  const entries = readdirSync(location, {withFileTypes:true})
    .filter(x => x.name.endsWith('.ores'));
  if (entries.length < minimum || entries.some(x => !x.isFile()))
    fail('missing or nonregular Oreslang source: ' + dir);
  return entries.map(x => dir + '/' + x.name).sort();
}
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
const actorPaths = [];
for (const [dir, minimum] of Object.entries(actorDirs))
  actorPaths.push(...listActors(base, dir, minimum));
if (actorPaths.length < 21) fail('incomplete actor source manifest');
const files = [...actorPaths, ...requiredGuestPaths].sort();
if (new Set(files).size !== files.length) fail('duplicate native source path');
const outcomes = [];
for (const file of files) {
  const source = join(base, file);
  if (!existsSync(source)) fail('missing native actor source: ' + file);
  const source_sha256 = sha256(readFileSync(source));
  const run = spawnSync(java, ['-cp',classes+delimiter+cp,
    'dev.oreslang.launcher.OresMain','--check',source],
  { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024*1024, shell: false });
  const passed = !run.error && run.status === 0 && !run.signal;
  outcomes.push({ file, source_sha256, passed, exit_code: run.status, signal: run.signal,
    stderr: (run.stderr || '').slice(-800) });
  if (!passed) break;
}
const positive_ok = outcomes.length === files.length && outcomes.every(x => x.passed);
let negative = null;
if (positive_ok) {
  const path = negativePath;
  const source = join(base, path);
  if (!existsSync(source)) fail('missing negative type fixture');
  const source_sha256 = sha256(readFileSync(source));
  const run = spawnSync(java, ['-cp', classes + delimiter + cp,
    'dev.oreslang.launcher.OresMain', '--check', source], {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024*1024, shell: false
  });
  // A failure merely due to syntax, missing classes, or a runner exception
  // does NOT satisfy a negative type checker test.
  const diagnostic = String(run.stderr || '') + '\n' + String(run.stdout || '');
  negative = {
    file: path, source_sha256, exit_code: run.status, signal: run.signal,
    expected_type_error: 'ActorRef.send mailbox value',
    passed: !run.error && !run.signal && run.status !== null &&
      run.status !== 0 && diagnostic.includes('ActorRef.send mailbox value'),
    diagnostic: diagnostic.slice(-1000)
  };
}
const passed = positive_ok && Boolean(negative && negative.passed);
console.log('NATIVE_CHECK_RESULT ' + JSON.stringify({compiler_source_head:head,
  scope:'OresMain --check; all actor and three guest checks plus one negative mailbox typing check; NOT guest execution',
  checked:outcomes.length, required:files.length, manifest:files,
  actor_count:actorPaths.length, negative, passed, outcomes}));
if (!passed) fail('native compiler positive or negative check failed; see diagnostics',1);
