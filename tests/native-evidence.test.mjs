import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { positive_files, negative_file, guest_names, sha256, verify_native_record } from '../scripts/native-evidence.mjs';

const context = { compiler_head: 'a'.repeat(40), compiler_tree: 'b'.repeat(40),
  root: fileURLToPath(new URL('../', import.meta.url)) };
const hash_file = path => sha256(readFileSync(join(context.root, path)));
function receipt(script) {
  const base = { passed: true, compiler_source_head: context.compiler_head,
    compiler_source_tree: context.compiler_tree };
  if (script === 'check-native-actors.mjs') return { ...base, checked: 10, required: 10,
    outcomes: positive_files.map(file => ({ file, source_sha256: hash_file(file),
      passed: true, exit_code: 0, signal: null })),
    negative: { file: negative_file, source_sha256: hash_file(negative_file), passed: true,
      exit_code: 1, signal: null, expected_type_error: 'ActorRef.send mailbox value',
      diagnostic: 'type error: ActorRef.send mailbox value mismatch' } };
  return { ...base, cases_required: 2, cases_executed: 2,
    results: guest_names.map(name => ({ name, passed: true, exit_code: 0, signal: null,
      error: null, stdout_exact: true, source_sha256: hash_file('tests/guest/' + name + '.ores'),
      oracle_sha256: hash_file('tests/guest/' + name + '.stdout'),
      stdout_sha256: hash_file('tests/guest/' + name + '.stdout') })) };
}
// Synthetic receipts test the validator only; they never execute a compiler.
for (const script of ['check-native-actors.mjs', 'run-native-guest.mjs']) {
  test('accepts complete synthetic receipt: ' + script, () => {
    verify_native_record(script, receipt(script), context);
  });
  for (const [name, change] of [
    ['stale compiler head', r => { r.compiler_source_head = 'c'.repeat(40); }],
    ['wrong compiler tree', r => { r.compiler_source_tree = 'c'.repeat(40); }],
    ['absent compiler tree', r => { delete r.compiler_source_tree; }],
    ['failed top-level result', r => { r.passed = false; }],
    ['duplicate fixture', r => { const a = r.outcomes || r.results; a[1] = structuredClone(a[0]); }],
    ['nonzero positive exit', r => { (r.outcomes || r.results)[0].exit_code = 1; }],
    ['signalled execution', r => { (r.outcomes || r.results)[0].signal = 'SIGKILL'; }],
    ['different source bytes', r => { (r.outcomes || r.results)[0].source_sha256 = 'c'.repeat(64); }],
    ['missing fixture', r => { (r.outcomes || r.results).pop(); }]
  ]) test('rejects ' + name + ': ' + script, () => {
    const record = receipt(script); change(record);
    assert.throws(() => verify_native_record(script, record, context));
  });
}
for (const [name, change] of [
  ['successful negative exit', r => { r.negative.exit_code = 0; }],
  ['null negative exit', r => { r.negative.exit_code = null; }],
  ['signal instead of type error', r => { r.negative.signal = 'SIGTERM'; }],
  ['generic syntax rejection', r => { r.negative.diagnostic = 'syntax error'; }],
  ['wrong negative source', r => { r.negative.file = positive_files[0]; }]
]) test('rejects ' + name, () => {
  const record = receipt('check-native-actors.mjs'); change(record);
  assert.throws(() => verify_native_record('check-native-actors.mjs', record, context));
});
for (const [name, change] of [
  ['wrong stdout bytes', r => { r.results[0].stdout_sha256 = 'c'.repeat(64); }],
  ['wrong oracle bytes', r => { r.results[0].oracle_sha256 = 'c'.repeat(64); }],
  ['guest spawn error', r => { r.results[0].error = 'ENOENT'; }]
]) test('rejects ' + name, () => {
  const record = receipt('run-native-guest.mjs'); change(record);
  assert.throws(() => verify_native_record('run-native-guest.mjs', record, context));
});
test('rejects unknown gate and missing receipt', () => {
  assert.throws(() => verify_native_record('invented.mjs', receipt('check-native-actors.mjs'), context));
  assert.throws(() => verify_native_record('check-native-actors.mjs', null, context));
});
