// Adversarial text-policy tests only. Native Oreslang compiler acceptance is separate.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditActorSource } from '../scripts/actor-state-audit.mjs';

const actors = [
  'agent_coordinator', 'agent_registry', 'decision_gate', 'decision_tree',
  'evidence_ledger', 'knowledge_cache', 'knowledge_graph', 'workflow'
];
const read = name => readFileSync(new URL('../src/' + name + '.ores', import.meta.url), 'utf8');

for (const name of actors) {
  test(name + ' has exactly one sealed state and no unscoped writes', () => {
    const report = auditActorSource(read(name));
    assert.deepEqual(report.problems, [], JSON.stringify(report));
    assert.ok(report.fields > 0);
    assert.ok(report.methods >= 3);
    assert.ok(report.writes >= 1);
  });
}
test('actor-wide sealed-state method inventory stays complete', () => {
  const reports = actors.map(name => auditActorSource(read(name)));
  assert.equal(reports.reduce((n, r) => n + r.methods, 0), 39);
  assert.equal(reports.reduce((n, r) => n + r.writes, 0), 17);
  assert.equal(reports.reduce((n, r) => n + r.fields, 0), 42);
});
test('state admission guard rejects forbidden source mutations', () => {
  const original = read('agent_registry');
  const mutations = [
    ['raw field', original.replace('  state {', '  let int illicit = 0;\n  state {')],
    ['extra val actor field', original.replace('  state {', '  val int illicit = 0;\n  state {')],
    ['extra var actor field', original.replace('  state {', '  var int illicit = 0;\n  state {')],
    ['extra const actor field', original.replace('  state {', '  const int illicit = 0;\n  state {')],
    ['second isolated actor without state schema', original + '\ndefine isolated actor Shadow as\nend\n'],
    ['second legacy actor without state schema', original + '\ndefine actor Shadow as\nend\n'],
    ['unmarked write', original.replace('self.handle_state(critical |s| -> {', 'self.handle_state(|s| -> {')],
    ['state array escape', original.replace('return s.revision;', 'return s.identities;')],
    ['wrapped state array escape', original.replace('return s.revision;', 'return Ok(s.identities);')],
    ['parenthesized state array escape', original.replace('return s.revision;', 'return (s.identities);')],
    ['state array alias', original.replace('return s.revision;', 'let copy = s.identities;\n      return copy;')],
    ['state array call argument', original.replace('return s.revision;', 'return consume(s.identities);')],
    ['unknown state field', original.replace('s.revision = s.revision + 1;', 's.unknown = s.revision + 1;')],
    ['missing write effect', original.replace('with state.read, state.write', 'with state.read')],
    ['suspension inside loan', original.replace('s.identities.add(id);', 'await bad;\n      s.identities.add(id);')],
    ['legacy actor', original.replace('define isolated actor AgentRegistryActor as', 'isoactor AgentRegistryActor {')]
  ];
  for (const [reason, source] of mutations) {
    assert.notEqual(source, original, 'mutation must apply: ' + reason);
    assert.notDeepEqual(auditActorSource(source).problems, [], reason);
  }
});

test('replacing the actor-owned Array under an exclusive loan is not reference escape', () => {
  const cache = readFileSync(new URL('../src/knowledge_cache.ores', import.meta.url), 'utf8');
  const result = auditActorSource(cache);
  assert.deepEqual(result.problems, [], JSON.stringify(result));
  assert.match(cache, /s\.keys = new Array<String>\(\)/);
});
