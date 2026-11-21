#!/usr/bin/env node
// Fail-closed guest execution against a pinned, locally built Java compiler.
// This is a single step-coordination Oreslang guest, not durable recovery.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(reason, code = 2) {
  console.error('NATIVE_GUEST_UNVERIFIED ' + reason);
  process.exit(code);
}
const demoExpected = process.env.ORESLANG_DEMO_SHA ?? '';
if (!/^[a-f0-9]{40}$/.test(demoExpected))
  fail('exact ORESLANG_DEMO_SHA is required');
const demoRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
try {
  const opts = { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 };
  const actual = execFileSync('git', ['-C',demoRoot,'rev-parse','HEAD'],opts).trim();
  const dirty = execFileSync('git', ['-C',demoRoot,'status','--porcelain','--untracked-files=no'],opts).trim();
  if (actual !== demoExpected || dirty)
    fail('demo revision mismatch or dirty tracked source');
} catch { fail('cannot validate demo source checkout'); }
const sha = process.env.ORESLANG_COMPILER_SHA ?? '';
const rootInput = process.env.ORESLANG_COMPILER_ROOT ?? '';
if (!/^[a-f0-9]{40}$/.test(sha) || !rootInput)
  fail('set ORESLANG_COMPILER_ROOT and exact ORESLANG_COMPILER_SHA');
let root;
try { root = realpathSync(resolve(rootInput)); }
catch { fail('compiler repository unavailable'); }
const classes = join(root, 'target', 'classes');
const cpFile = join(root, 'target', 'runtime-classpath.txt');
if (!existsSync(classes) || !existsSync(cpFile))
  fail('missing built classes or runtime classpath');
let head, dirty;
try {
  const opts = { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 };
  head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], opts).trim();
  dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], opts).trim();
} catch { fail('compiler checkout provenance unavailable'); }
if (head !== sha || dirty) fail('compiler SHA mismatch or modified tracked source');
const dependencies = readFileSync(cpFile, 'utf8').trim();
if (!dependencies) fail('empty runtime classpath');

const cases = ['step_agent_flow'];
const sha256 = b => createHash('sha256').update(b).digest('hex');
const java = process.env.ORESLANG_JAVA_BIN || 'java';
const results = [];
for (const name of cases) {
  const source = fileURLToPath(new URL('../tests/guest/' + name + '.ores', import.meta.url));
  const oracle = fileURLToPath(new URL('../tests/guest/' + name + '.stdout', import.meta.url));
  if (!existsSync(source) || !existsSync(oracle)) fail('missing guest source or oracle for ' + name);
  const sourceBytes = readFileSync(source), expected = readFileSync(oracle);
  if (!sourceBytes.length || !expected.length) fail('empty guest source or oracle for ' + name);
  const start = Date.now();
  const run = spawnSync(java, ['-cp', classes + delimiter + dependencies,
    'dev.oreslang.launcher.OresMain', source], {
    cwd: root, encoding: 'buffer', timeout: 30000,
    maxBuffer: 2 * 1024 * 1024, shell: false
  });
  const passed = !run.error && !run.signal && run.status === 0 &&
    Boolean(run.stdout && run.stdout.equals(expected));
  results.push({
    name, passed, exit_code: run.status, signal: run.signal,
    stdout_exact: Boolean(run.stdout && run.stdout.equals(expected)),
    source_sha256: sha256(sourceBytes), oracle_sha256: sha256(expected),
    duration_ms: Date.now() - start,
    stderr: run.stderr ? run.stderr.toString('utf8').slice(-1200) : '',
    error: run.error ? String(run.error.message) : null
  });
  if (!passed) break;
}
const ok = results.length === cases.length && results.every(r => r.passed);
console.log('STEP_NATIVE_GUEST_RESULT ' + JSON.stringify({
  compiler_source_head: head, cases_required: cases.length,
  cases_executed: results.length, passed: ok, results,
  scope: 'Java preview-only step guest with ordered/foreign/duplicate guards; no durable execution'
}));
if (!ok) fail('actual guest execution failed or stdout mismatched', 1);
