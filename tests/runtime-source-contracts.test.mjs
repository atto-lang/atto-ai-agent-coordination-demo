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
    assert.match(src, new RegExp('^isoactor\\s+' + actor + '\\s*\\{', 'm'));
    assert.equal((src.match(/^isoactor\s+/gm) || []).length, 1);
    for (const method of methods) assert.ok(src.includes('pub fnc ' + method + '('), method);
    assert.doesNotMatch(src, /\b(?:System\.|java\.|python3?|subprocess)\b/);
  });
}
test('routing is identity and route-epoch pinned', () => {
  const s = read('actor_route_directory');
  for (const x of [
    'self.incarnations[i] != expected_incarnation',
    'self.route_epochs[i] != expected_epoch',
    'next_incarnation <= expected_incarnation',
    'self.incarnations[i] != incarnation',
    'self.generations[i] != generation',
    'self.route_epochs[i] != epoch',
    'self.active[i] = false',
    'self.actor_ids.size >= 512'
  ]) assert.ok(s.includes(x), x);
});
test('graph supports dependency fan-in with CAS and fail-closed states', () => {
  const s = read('execution_graph');
  for (const x of [
    'self.node_ids.size >= 128',
    'self.dependents.size >= 512',
    'prerequisite_pos >= node_pos',
    'if self.sealed || node == prerequisite',
    'if !found; then return false; fi',
    'expected_revision != self.revision',
    'self.node_states[i] == 1',
    'self.node_states[i] = 3',
    'self.node_states[i] = 4'
  ]) assert.ok(s.includes(x), x);
});
test('dispatched effects remain unknown until reconciliation', () => {
  const s = read('workflow_effect_ledger');
  for (const x of [
    'self.effect_keys.size >= 256',
    'if existing == effect_key; then return false; fi',
    'self.states[i] = 1',
    'self.states[i] == 1',
    'self.states[i] = 2',
    'self.states[i] = 4',
    'self.states[i] = 3',
    'receipt == ""',
    'expected_epoch != self.transition_epoch'
  ]) assert.ok(s.includes(x), x);
});
