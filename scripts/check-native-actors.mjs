#!/usr/bin/env node
// Compile-only gate for all Oreslang actor sources and .ores guest fixtures.
// This executes the Java OresMain --check compiler, NOT guest actor behavior.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deterministic discovery; skip symlinks and reject missing source roots.
const expectedActorDirs = { 'src': 8, 'src/memory': 9, 'src/runtime': 3 };
const expectedGuestDirs = { 'tests/guest': 1 };
const enumerate = (base, dir) => {
  const location = join(base, dir);
  if (!existsSync(location)) fail('native source directory missing: ' + dir);
  return readdirSync(location, { withFileTypes: true })
    .filter(x => x.isFile() && x.name.endsWith('.ores'))
    .map(x => dir + '/' + x.name).sort();
};
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
const files = [];
for (const [dir, minCount] of Object.entries({...expectedActorDirs, ...expectedGuestDirs})) {
  const found = enumerate(base, dir);
  if (found.length < minCount) fail('native actor source count below minimum in ' + dir);
  files.push(...found);
}
if (files.length < 21 || new Set(files).size !== files.length)
  fail('empty or duplicate native source manifest');
files.sort();
const outcomes = [];
for (const file of files) {
  const source = join(base, file);
  if (!existsSync(source)) fail('missing native actor source: ' + file);
  const sourceSha256 = createHash('sha256').update(readFileSync(source)).digest('hex');
  const run = spawnSync(java, ['-cp',classes+delimiter+cp,
    'dev.oreslang.launcher.OresMain','--check',source],
  { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024*1024, shell: false });
  const passed = !run.error && run.status === 0 && !run.signal;
  outcomes.push({ file, source_sha256: sourceSha256, passed, exit_code: run.status, signal: run.signal,
    stderr: (run.stderr || '').slice(-800) });
  if (!passed) break;
}
const passed = outcomes.length === files.length && outcomes.every(x => x.passed);
console.log('NATIVE_CHECK_RESULT ' + JSON.stringify({compiler_source_head:head,
  scope:'OresMain --check; does not prove actual guest execution',
  checked:outcomes.length, required:files.length, manifest:files, passed, outcomes}));
if (!passed) fail('native compiler check failed; see diagnostics',1);
