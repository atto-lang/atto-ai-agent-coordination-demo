// These tests are native-guest FIXTURE and runner-contract tests only.
// They do not compile .ores. The native launcher is exercised separately.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./guest/agent_pipeline.ores', import.meta.url), 'utf8');
const expected = readFileSync(new URL('./guest/agent_pipeline.stdout', import.meta.url), 'utf8');
const runner = new URL('../scripts/run-native-guest.mjs', import.meta.url);

test('guest fixture declares a cache and three active actor agents', () => {
  for (const name of ['KnowledgeCacheActor', 'ResearchAgent', 'AnalysisAgent', 'ExecutionAgent']) {
    assert.match(source, new RegExp('define actor ' + name + ' as'));
  }
  assert.equal((source.match(/receive\(ActorMail<String> mail\)/g) ?? []).length, 4);
  assert.match(source, /await cache\.get_ready\(\)/);
  assert.match(source, /await cache\.get_done\(\)/);
  assert.match(source, /cache\.send\("lookup"\)/);
  assert.match(source, /analyzer\.send\(evidence\.value\)/);
  assert.match(source, /executor\.send\(decision\.value\)/);
});

test('guest fixture has exact nonempty stdout oracle and scoped expectations', () => {
  assert.equal(expected, '1|2|evidence-ready|approved|executed');
  assert.equal((source.match(/cache\.send\("lookup"\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /\bhost\./);
});

test('native runner fails closed when compiler and provenance are absent', () => {
  const env = { ...process.env };
  delete env.ORESLANG_COMPILER_ROOT;
  delete env.ORESLANG_COMPILER_SHA;
  const run = spawnSync(process.execPath, [runner.pathname], { encoding: 'utf8', env, timeout: 5000 });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /NATIVE_GUEST_UNVERIFIED/);
  assert.doesNotMatch(run.stdout, /"passed":true/);
});

test('native runner rejects malformed compiler commit identities', () => {
  const run = spawnSync(process.execPath, [runner.pathname], {
    encoding: 'utf8',
    env: { ...process.env, ORESLANG_COMPILER_ROOT: '.', ORESLANG_COMPILER_SHA: 'main' },
    timeout: 5000
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /exact ORESLANG_COMPILER_SHA/);
});
