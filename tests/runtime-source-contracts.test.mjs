// Structural checks only; NOT executed Oreslang actor semantics.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const actorInfo = [
  ['actor_route_directory', 'ActorRouteDirectoryActor',
    ['register', 'relocate', 'resolve', 'retire', 'route_epoch']],
  ['execution_graph', 'ExecutionGraphActor',
    ['add_node', 'depends_on', 'seal', 'ready', 'start', 'settle', 'cancel_pending']],
  ['workflow_effect_ledger', 'WorkflowEffectLedgerActor',
    ['prepare', 'dispatch', 'reconcile', 'cancel_prepared', 'state_of']]
];
const read = name => readFileSync(new URL('../src/runtime/' + name + '.ores', import.meta.url), 'utf8');
for (const [path, actor, methods] of actorInfo) {
  test(actor + ' is an isolated native userland declaration', () => {
    const src = read(path);
    assert.match(src, new RegExp('^define\\s+isolated\\s+actor\\s+' + actor + '\\s+as', 'm'));
    assert.equal((src.match(/^define isolated actor /gm) || []).length, 1);
    for (const method of methods) assert.ok(src.includes('pub ' + method + '('), method);
    assert.doesNotMatch(src, /\b(?:System\.|java\.|python3?|subprocess)\b/);
  });
}
test('routing is identity and route-epoch pinned', () => {
  const s = read('actor_route_directory');
  for (const x of [
    's.incarnations[i] != expected_incarnation',
    's.route_epochs[i] != expected_epoch',
    'next_incarnation <= expected_incarnation',
    'next_generation <= s.generations[i]',
    'next_generation >= 2147483646',
    's.incarnations[i] != incarnation',
    's.generations[i] != generation',
    's.route_epochs[i] != epoch',
    's.active[i] = false',
    's.actor_ids.size >= 512'
  ]) assert.ok(s.includes(x), x);
});
test('graph supports dependency fan-in with CAS and fail-closed states', () => {
  const s = read('execution_graph');
  for (const x of [
    's.node_ids.size >= 128',
    's.dependents.size >= 512',
    'prerequisite_pos >= node_pos',
    'if s.sealed || node == prerequisite',
    'if !found; then dependencies_met = false; fi',
    'expected_revision != s.revision',
    's.node_states[i] == 1',
    's.node_states[i] = 3',
    's.node_states[i] = 4'
  ]) assert.ok(s.includes(x), x);
});
test('dispatched effects remain unknown until reconciliation', () => {
  const s = read('workflow_effect_ledger');
  for (const x of [
    's.effect_keys.size >= 256',
    'if existing == effect_key; then return false; fi',
    's.states[i] = 1',
    's.states[i] == 1',
    's.states[i] = 2',
    's.states[i] = 4',
    's.states[i] = 3',
    'receipt == ""',
    'expected_epoch != s.transition_epoch'
  ]) assert.ok(s.includes(x), x);
});

import { auditActorSource } from '../scripts/actor-state-audit.mjs';
for (const [file] of actorInfo) {
  test(file + ' uses sealed state loans and critical mutation', () => {
    const result = auditActorSource(read(file));
    assert.deepEqual(result.problems, [], JSON.stringify(result));
    assert.ok(result.writes > 0);
  });
}

test('graph start checks every dependency under the same critical state loan before dispatch', () => {
  const src = read('execution_graph');
  const start = src.slice(src.indexOf('  pub start('), src.indexOf('  pub settle('));
  const settle = src.slice(src.indexOf('  pub settle('), src.indexOf('  pub cancel_pending('));
  assert.match(start, /self\.handle_state\(critical \|s\| -> \{/);
  assert.match(start, /if !dependencies_met; then return false; fi/);
  assert.ok(start.indexOf('if !dependencies_met; then return false; fi') <
    start.indexOf('s.node_states[i] = 1'), 'dependency gate must precede dispatch');
  assert.doesNotMatch(settle, /dependencies_met/);
  assert.match(settle, /s.node_states\[i\] = 2/);
});
