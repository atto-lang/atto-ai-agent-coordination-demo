#!/usr/bin/env node
// Fail-closed native Oreslang guest runner. No Python and no cross-org checkout.
// Required environment:
//   ORESLANG_COMPILER_ROOT=/path/to/oreslang-source.java
//   ORESLANG_COMPILER_SHA=<exact 40-digit Git HEAD>
// Optional ORESLANG_JAVA_BIN (default: java).
// Only a trusted, locally built compiler checkout is accepted. A matching
// source SHA does not by itself attest that compiled class files match it.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message, status = 2) {
  console.error('NATIVE_GUEST_UNVERIFIED ' + message);
  process.exit(status);
}
const sha = process.env.ORESLANG_COMPILER_SHA ?? '';
const rootInput = process.env.ORESLANG_COMPILER_ROOT ?? '';
if (!/^[a-f0-9]{40}$/.test(sha) || !rootInput) {
  fail('set ORESLANG_COMPILER_ROOT and exact ORESLANG_COMPILER_SHA');
}

let root;
try { root = realpathSync(resolve(rootInput)); }
catch { fail('compiler repository not present'); }

const fixture = fileURLToPath(new URL('../tests/guest/agent_pipeline.ores', import.meta.url));
const oracle = fileURLToPath(new URL('../tests/guest/agent_pipeline.stdout', import.meta.url));
const classes = join(root, 'target', 'classes');
const runtimePath = join(root, 'target', 'runtime-classpath.txt');
if (!existsSync(classes) || !existsSync(runtimePath) ||
    !existsSync(fixture) || !existsSync(oracle)) {
  fail('missing compiled classes, runtime classpath, guest source, or oracle');
}

let head;
let dirty;
try {
  const options = { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 };
  head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], options).trim();
  dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], options).trim();
} catch {
  fail('compiler checkout provenance could not be inspected');
}
if (head !== sha || dirty) {
  fail('compiler checkout SHA mismatch or modified tracked files');
}
const dependencies = readFileSync(runtimePath, 'utf8').trim();
if (!dependencies) fail('empty runtime classpath');

const expected = readFileSync(oracle);
const source = readFileSync(fixture);
if (expected.length === 0 || source.length === 0) fail('zero-byte fixture or oracle');
const hash = data => createHash('sha256').update(data).digest('hex');
const java = process.env.ORESLANG_JAVA_BIN || 'java';
const command = [ '-cp', classes + delimiter + dependencies,
  'dev.oreslang.launcher.OresMain', fixture ];
const start = Date.now();
const result = spawnSync(java, command, {
  cwd: root, encoding: 'buffer', timeout: 30000,
  maxBuffer: 2 * 1024 * 1024, shell: false
});
const report = {
  test: 'agent_pipeline',
  scope: 'native Java guest stdout oracle, not full compiler parity or crash recovery',
  compiler_source_head: head,
  compiler_worktree_clean: true,
  fixture_sha256: hash(source),
  oracle_sha256: hash(expected),
  exit_code: result.status,
  signal: result.signal,
  milliseconds: Date.now() - start,
  stdout_exact: Boolean(result.stdout && result.stdout.equals(expected)),
  executed: !result.error && result.status !== null
};
const ok = report.executed && report.exit_code === 0 && report.stdout_exact;
console.log('NATIVE_GUEST_RESULT ' + JSON.stringify({ ...report, passed: ok }));
if (!ok) {
  if (result.error) console.error(String(result.error.message));
  if (result.stderr) console.error(result.stderr.toString('utf8').slice(-2500));
  fail('real guest execution did not match exact stdout oracle', 1);
}
