// Source/runner contract ONLY. No Oreslang compiler or guest execution here.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditActorSource } from '../scripts/actor-state-audit.mjs';

const load = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const step = load('src/runtime/step_run.ores');
const dag = load('src/runtime/execution_graph.ores');
const fixture = load('tests/guest/step_agent_flow.ores');
const oracle = load('tests/guest/step_agent_flow.stdout');
const runner = load('scripts/run-step-native-guest.mjs');

test('per-run step actor is sealed, bounded and state-loan scoped', () => {
  const result = auditActorSource(step);
  assert.deepEqual(result.problems, [], JSON.stringify(result));
  assert.equal(result.actor, 'StepRunActor');
  assert.equal(result.writes, 6);
  assert.equal(result.reads, 3);
  assert.equal(result.methods, 9);
});
test('every transition is tenant, run, step, epoch and CAS-version fenced', () => {
  for (const method of [
    'begin_attempt', 'mark_unknown', 'proved_not_applied', 'commit_verified',
    'cancel_before_dispatch'
  ]) {
    const slice = step.slice(step.indexOf('  pub ' + method + '('),
      step.indexOf('  pub ', step.indexOf('  pub ' + method + '(') + 7));
    for (const item of [
      'tenant != s.tenant_id', 'run != s.run_id', 'step != s.step_id',
      'exact_revision != s.source_revision',
      'expected_epoch != s.activation_epoch',
      'expected_version != s.version',
      's.version >= 2147483646'
    ]) assert.ok(slice.includes(item), method + ' missing ' + item);
  }
});
test('idempotency keys are unique, retries bounded, unknown cannot rerun', () => {
  assert.match(step,/attempt_limit < 1 \|\| attempt_limit > 8/);
  assert.match(step,/s\.used_keys\.size >= 8/);
  assert.match(step,/for \(const previous of s\.used_keys\)/);
  assert.match(step,/previous == idempotency_key; then return false;/);
  const begin = step.slice(step.indexOf('  pub begin_attempt('),step.indexOf('  pub mark_unknown('));
  assert.match(begin,/\(s\.phase != 1 && s\.phase != 3\)/);
  assert.doesNotMatch(begin,/s\.phase == 7/);
  assert.match(step,/s\.phase = 7;/);
});
test('cancel refuses in-flight and unknown effects; reconciliation is explicit', () => {
  const cancel = step.slice(step.indexOf('  pub cancel_before_dispatch('),step.indexOf('  pub phase_of('));
  assert.match(cancel,/\(s\.phase != 1 && s\.phase != 3\)/);
  assert.match(cancel,/s\.phase = 6;/);
  assert.match(step,/s\.phase = 4;/);
  assert.match(step,/s\.phase = 5;/);
  assert.doesNotMatch(step.replace(/^\/\/.*$/gm,''),/\b(?:await|spawn|stdio|process|http|fetch)\b/);
});
test('blocked DAG node cancellation requires a failed/cancelled prerequisite', () => {
  const offset=dag.indexOf('  pub cancel_blocked(');
  assert.ok(offset>0);
  const fn=dag.slice(offset,dag.indexOf('  pub current_revision(',offset));
  assert.match(fn,/expected_revision != s\.revision/);
  assert.match(fn,/s\.node_states\[position\] != 0/);
  assert.match(fn,/s\.node_states\[j\] == 3 \|\| s\.node_states\[j\] == 4/);
  assert.ok(fn.indexOf('if !blocked; then return false; fi') <
    fn.indexOf('s.node_states[position] = 4;'));
});
test('native step fixture rejects foreign, early and duplicate messages', () => {
  assert.match(fixture,/define actor AgentRunGuard as/);
  assert.match(fixture,/define actor AgentResearchStep as/);
  assert.match(fixture,/define actor AgentReviewStep as/);
  assert.match(fixture,/define actor AgentPreviewStep as/);
  for(const item of ['out-of-order','duplicate-start','tenant-b:run-1:start',
    'reviewed-fixture-only','preview-only'])assert.ok(fixture.includes(item));
  assert.doesNotMatch(fixture,/\b(?:publish|deploy|execute_tool)\(/);
  assert.equal(oracle,'agent-step:preview-complete');
});
test('step native runner pins compiler and demo revision, exact output and timeout', () => {
  assert.match(runner,/ORESLANG_DEMO_SHA/);
  assert.match(runner,/ORESLANG_COMPILER_SHA/);
  assert.match(runner,/'status','--porcelain','--untracked-files=no'/);
  assert.match(runner,/STEP_NATIVE_GUEST_RESULT/);
  assert.match(runner,/run\.status === 0/);
  assert.match(runner,/run\.stdout\.equals\(expected\)/);
  assert.match(runner,/timeout: 30000/);
  assert.match(runner,/'step_agent_flow'/);
});
test('native step runner fails closed without pinned Git checkout', () => {
  const env={...process.env};
  delete env.ORESLANG_DEMO_SHA;
  delete env.ORESLANG_COMPILER_ROOT;
  delete env.ORESLANG_COMPILER_SHA;
  const result=spawnSync(process.execPath,
    [fileURLToPath(new URL('../scripts/run-step-native-guest.mjs', import.meta.url))],
    {env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,2);
  assert.match(result.stderr,/NATIVE_GUEST_UNVERIFIED/);
  assert.doesNotMatch(result.stdout,/STEP_NATIVE_GUEST_RESULT/);
});
