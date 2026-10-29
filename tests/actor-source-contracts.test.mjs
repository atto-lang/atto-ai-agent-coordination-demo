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
    assert.match(source, new RegExp('define\\s+isolated\\s+actor\\s+' + required[0] + '\\s+as'));
    for (const member of required.slice(1))
      assert.match(source, new RegExp('pub\\s+' + member + '\\s*\\('));
    assert.doesNotMatch(source, /\bisoactor\b|\bpub\s+fnc\b/);
    assert.match(source, /\bend\s*$/);
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
  assert.match(source, /if !source_known \|\| !target_known/);
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

test('decision DAG accepts only previously declared nodes and terminals', () => {
  const source = read('decision_tree');
  assert.match(source, /pub add_terminal\s*\(/);
  assert.match(source, /s\.terminal_ids\.add\(id\)/);
  assert.match(source, /if !true_known \|\| !false_known; then return false; fi/);
  assert.match(source, /s\.node_ids\.size \+ s\.terminal_ids\.size >= 256/);
  assert.match(source, /pub is_terminal\s*\(/);
  assert.match(source, /required_revision != s\.revision/);
  assert.doesNotMatch(source, /eval\s*\(|Function\s*\(/);
});

test('cache binds one graph identity and requires strictly newer revisions', () => {
  const source = read('knowledge_cache');
  assert.match(source, /s\.graph_id != "" && id != s\.graph_id/);
  assert.match(source, /revision <= s\.graph_revision/);
  assert.match(source, /reusable = i/);
  assert.match(source, /s\.keys\[reusable\] = key/);
  assert.match(source, /now >= s\.expires_at\[i\]/);
  assert.match(source, /s\.keys\.size >= 1024/);
});

test('workflow transitions require compare-and-set and refuse terminal replay', () => {
  const source = read('workflow');
  assert.match(source, /expected_transition != s\.transition_number/);
  assert.match(source, /s\.phase < 1 \|\| s\.phase > 3/);
  assert.match(source, /s\.phase >= 4/);
});

test('evidence, registry and coordinator never derive identity from model text alone', () => {
  const ledger = read('evidence_ledger');
  const registry = read('agent_registry');
  const coordinator = read('agent_coordinator');
  assert.match(ledger, /steps <= 0/);
  assert.match(ledger, /duplicate|existing == receipt/);
  assert.match(registry, /s\.incarnations\[i\] == incarnation/);
  assert.match(coordinator, /s\.owners\[i\] != owner/);
  assert.match(coordinator, /s\.states\[i\] != 0/);
});

const writerMethods = {"agent_coordinator":["submit","settle"],"agent_registry":["register"],"decision_gate":["begin","record_executed_check","record_review","invalidate"],"decision_tree":["add_terminal","add_branch"],"evidence_ledger":["append"],"knowledge_cache":["activate","put"],"knowledge_graph":["add_entity","add_edge"],"workflow":["start","advance","cancel"]};
for (const [name, writerNames] of Object.entries(writerMethods)) {
  test(name + ' has one sealed state and scoped critical mutations', () => {
    const source = read(name);
    assert.equal((source.match(/^\s*state\s*\{/gm) || []).length, 1);
    assert.doesNotMatch(source, /^  let /m);
    assert.doesNotMatch(source, /\bself\.(?!handle_state\()/);
    const methods = [...source.matchAll(/^  pub\s+(\w+)\s*\(/gm)];
    const loans = [...source.matchAll(/self\.handle_state\((?:critical )?\|s\| -> \{/g)];
    assert.equal(methods.length, loans.length, 'each method must have a state loan');
    const criticalCount = [...source.matchAll(/self\.handle_state\(critical \|s\| -> \{/g)].length;
    assert.equal(criticalCount, writerNames.length);
    for (const method of writerNames) {
      const i = source.indexOf('pub ' + method + '(');
      assert.ok(i >= 0);
      const j = source.indexOf('\n  pub ', i+4);
      const declaration = source.slice(i,j<0?undefined:j);
      assert.match(declaration, /with state\.(?:read, state\.write|write)/);
      assert.match(declaration, /self\.handle_state\(critical \|s\| -> \{/);
    }
  });
}
