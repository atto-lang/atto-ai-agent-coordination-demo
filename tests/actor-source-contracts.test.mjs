// These are source-level policy checks, NOT Oreslang compilation or execution.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const actors = {
  'knowledge_graph': ['KnowledgeGraphActor', 'add_entity', 'add_edge', 'neighbors'],
  'knowledge_cache': ['KnowledgeCacheActor', 'activate', 'put', 'get'],
  'decision_tree': ['DecisionTreeActor', 'add_branch', 'next'],
  'decision_gate': ['DecisionGateActor', 'begin', 'record_executed_check', 'record_review', 'can_commit', 'invalidate'],
  'evidence_ledger': ['EvidenceLedgerActor', 'append', 'has_success'],
  'agent_coordinator': ['AgentCoordinatorActor', 'submit', 'settle'],
  'workflow': ['AgentWorkflowActor', 'start', 'advance', 'cancel'],
  'agent_registry': ['AgentRegistryActor', 'register', 'supports']
};
const read = (name) => readFileSync(new URL('../src/' + name + '.ores', import.meta.url), 'utf8');

for (const [name, required] of Object.entries(actors)) {
  test(name + ' has a native isolated actor and its public contract', () => {
    const source = read(name);
    assert.match(source, new RegExp('isoactor\\s+' + required[0] + '\\s*\\{'));
    for (const member of required.slice(1))
      assert.match(source, new RegExp('pub fnc\\s+' + member + '\\s*\\('));
    assert.doesNotMatch(source, /\b(?:java\.|System\.|python3?|subprocess)\b/);
  });
}

test('decision gate requires nonzero executed steps and exact revision', () => {
  const source = read('decision_gate');
  assert.match(source, /executed_steps > 0/);
  assert.match(source, /revision != self.exact_revision/);
  assert.match(source, /self.independent_approval/);
  assert.match(source, /self.admission_verified/);
});
test('cache is revision pinned and bounded', () => {
  const source = read('knowledge_cache');
  assert.match(source, /revision != self.graph_revision/);
  assert.match(source, /self.keys.size >= 1024/);
  assert.match(source, /now >= self.expires_at\[i\]/);
});
test('graph verifies endpoints and is bounded', () => {
  const source = read('knowledge_graph');
  assert.match(source, /!self.contains\(source\) \|\| !self.contains\(target\)/);
  assert.match(source, /self.ids.size >= 4096/);
  assert.match(source, /self.edge_from.size >= 16384/);
});
test('coordinator enforces admission and duplicate-settlement guard', () => {
  const source = read('agent_coordinator');
  assert.match(source, /self.active_count >= 64/);
  assert.match(source, /self.task_keys.size >= 4096/);
  assert.match(source, /self.states\[i\] != 0/);
  assert.match(source, /duplicate task key/);
});
