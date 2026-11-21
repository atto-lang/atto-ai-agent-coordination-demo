// SOURCE-ONLY actor state/critical-loan contracts. Not a compiler test.
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../src/', import.meta.url);
const dirs = ['.', 'memory', 'runtime'];
const files = dirs.flatMap(dir => {
  const url = new URL(dir === '.' ? './' : dir + '/', root);
  return readdirSync(url).filter(name => name.endsWith('.ores'))
    .map(name => new URL(name, url));
});

test('all 20 actors are covered and all persistent instance fields are sealed', () => {
  assert.equal(files.length, 20);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /^define isolated actor \w+ as/m, file.pathname);
    assert.equal((source.match(/^  state \{/gm) || []).length, 1, file.pathname);
    assert.doesNotMatch(source, /^  let\s+\w+/m, file.pathname);
    assert.doesNotMatch(source, /\bself\.state\b/, file.pathname);
    assert.match(source, /\bend\s*$/, file.pathname);
    const fields = source.match(/^    [a-zA-Z_]\w*: [^\n]+ = [^\n]+;/gm) || [];
    assert.ok(fields.length > 0, file.pathname);
    for (const field of fields) {
      const name = /^    ([a-zA-Z_]\w*):/.exec(field)?.[1];
      assert.ok(name, file.pathname);
      assert.ok(!source.includes('self.' + name), file.pathname + ' has direct state access');
    }
    const methods = (source.match(/^  (?:pub )?[a-zA-Z_]\w*\(/gm) || []).length;
    const loans = (source.match(/return self\.handle_state\(critical \|s\| -> \{/g) || []).length;
    assert.ok(methods > 0, file.pathname);
    assert.equal(loans, methods, file.pathname + ' has unguarded method');
    assert.doesNotMatch(source, /\bawait\b/, file.pathname);
  }
});

test('graph dependent checks are computed in the same critical loan', () => {
  const graph = readFileSync(new URL('../src/knowledge_graph.ores', import.meta.url), 'utf8');
  assert.match(graph, /for \(const known_id of s\.ids\)/);
  assert.doesNotMatch(graph, /self\.contains\(/);
  const schedule = readFileSync(new URL('../src/runtime/execution_graph.ores', import.meta.url), 'utf8');
  assert.match(schedule, /if !all_prerequisites_done; then return false; fi/);
  assert.doesNotMatch(schedule, /self\.prerequisites_done\(/);
});
