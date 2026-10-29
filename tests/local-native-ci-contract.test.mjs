// Self-contained offline CI admission checks. These DO NOT execute Oreslang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../scripts/run-local-native-ci.sh', import.meta.url));
const source = readFileSync(file, 'utf8');
const run = env => spawnSync('bash', [file], { encoding:'utf8',timeout:5000,env });

test('offline acceptance script is valid Bash and has no cross-org transport', () => {
  const syntax = spawnSync('bash',['-n',file],{encoding:'utf8',timeout:5000});
  assert.equal(syntax.status,0,syntax.stderr);
  assert.doesNotMatch(source, /\b(?:curl|wget|rsync|scp|python3?|git clone)\b/);
  assert.doesNotMatch(source, /GITHUB_TOKEN|GH_TOKEN/);
});
test('requires exact source SHA, isolated checkouts and clean tracked trees', () => {
  assert.match(source, /ORESLANG_COMPILER_SHA/);
  assert.match(source, /ORESLANG_DEMO_SHA/);
  assert.match(source, /status --porcelain --untracked-files=no/);
  assert.match(source, /rev-parse 'HEAD\^\{tree\}'/);
  assert.match(source, /JDK 25 required/);
  assert.match(source, /GraalVM JDK 25 required/);
});
test('rebuild is offline and native acceptance runs only after source checks', () => {
  assert.match(source, /mvn -o -B -ntp -DskipTests clean package dependency:build-classpath/);
  assert.match(source, /node --test tests\/\*\.test\.mjs/);
  assert.match(source, /node scripts\/run-native-acceptance\.mjs/);
  assert.match(source, /LOCAL_NATIVE_CI_RESULT passed=true/);
});
test('malformed compiler SHA fails without executing a build', () => {
  const r=run({...process.env,ORESLANG_COMPILER_ROOT:'/tmp',
    ORESLANG_COMPILER_SHA:'main',ORESLANG_DEMO_SHA:'a'.repeat(40)});
  assert.equal(r.status,2);
  assert.match(r.stderr,/LOCAL_NATIVE_CI_UNVERIFIED invalid compiler SHA/);
  assert.doesNotMatch(r.stdout,/LOCAL_NATIVE_CI_RESULT/);
});
test('malformed demo SHA also fails without executing a build', () => {
  const r=run({...process.env,ORESLANG_COMPILER_ROOT:'/tmp',
    ORESLANG_COMPILER_SHA:'a'.repeat(40),ORESLANG_DEMO_SHA:'main'});
  assert.equal(r.status,2);
  assert.match(r.stderr,/LOCAL_NATIVE_CI_UNVERIFIED invalid demo SHA/);
});

test('guest-only mode has a distinct success label and does not claim sealed state', () => {
  assert.match(source, /scope === "guest-only"/);
  assert.match(source, /node scripts\/run-native-guest\.mjs/);
  assert.match(source, /LOCAL_NATIVE_GUEST_SMOKE_RESULT passed=true/);
  assert.match(source, /guest_only_no_sealed_actor_validation/);
  assert.match(source, /node scripts\/run-native-acceptance\.mjs/);
  assert.match(source, /LOCAL_NATIVE_CI_RESULT passed=true/);
});
test('native scope cannot be an unrecognized value', () => {
  const r=run({...process.env,ORESLANG_COMPILER_ROOT:'/tmp',
    ORESLANG_COMPILER_SHA:'a'.repeat(40),
    ORESLANG_DEMO_SHA:'b'.repeat(40),
    ORESLANG_NATIVE_SCOPE:'skip-checks'});
  assert.equal(r.status,2);
  assert.match(r.stderr,/LOCAL_NATIVE_CI_UNVERIFIED invalid native scope/);
});
