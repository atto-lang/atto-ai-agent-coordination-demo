// SOURCE ONLY: does not parse/execute Oreslang or prove authorization.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditActorSource } from '../scripts/actor-state-audit.mjs';

const text = readFileSync(new URL('../src/memory/context_assembly.ores', import.meta.url), 'utf8');
const method = (name, next) => {
  const start = text.indexOf('pub ' + name + '(');
  const end = next ? text.indexOf('pub ' + next + '(', start + 1) : text.lastIndexOf('\nend');
  assert.ok(start >= 0 && end > start, name + ' missing');
  return text.slice(start, end);
};
test('manifest is one native isolated state owner with scoped loans', () => {
  const audit = auditActorSource(text);
  assert.deepEqual(audit.problems, []);
  assert.equal(audit.actor, 'ContextAssemblyActor');
  assert.equal(audit.fields, 6);
  assert.equal(audit.methods, 7);
  assert.equal(audit.writes, 3);
  assert.equal(audit.reads, 4);
});
test('raw excerpt and caller token-estimate entrypoints are absent', () => {
  assert.doesNotMatch(text, /\bpub\s+add\s*\(/);
  assert.doesNotMatch(text, /\bpub\s+remaining_budget\s*\(/);
  assert.doesNotMatch(text, /(?:excerpts|token_estimates|tokens|remaining):\s*(?:Array<[^>]+>|int)\s*=/);
  assert.doesNotMatch(text, /\b(?:estimated_tokens|token_budget)\s*:/);
});
test('legacy excerpt publication fails closed for all callers', () => {
  const body = method('selected_excerpts', 'current_count');
  assert.ok(body.includes('return Err("native excerpt publication disabled'));
  assert.doesNotMatch(body, /\breturn\s+Ok\s*\(/);
  assert.doesNotMatch(body, /\bs\.(?:excerpts|evidence_refs|memory_ids)\b/);
  assert.ok(body.includes('self.handle_state(|s| -> {'));
});
test('staging only stores untrusted references with strict scope and size bound', () => {
  const body = method('stage_reference', 'seal');
  for (const guard of ['!s.started','s.sealed','task != s.task_id',
    'exact_revision != s.revision', 'memory_id == ""',
    'evidence_ref == ""','s.memory_ids.size >= 24',
    'if existing == memory_id; then return false; fi']) {
    assert.ok(body.includes(guard), 'missing ' + guard);
  }
  assert.ok(body.indexOf('s.memory_ids.size >= 24') <
    body.indexOf('s.memory_ids.add(memory_id)'));
  assert.ok(body.includes('s.evidence_refs.add(evidence_ref)'));
});
test('seal is one-time and exact-task/revision pinned', () => {
  const body = method('seal', 'selected_ids');
  for (const guard of ['!s.started','s.sealed','task != s.task_id',
    'exact_revision != s.revision','s.sealed = true']) assert.ok(body.includes(guard));
  assert.ok(body.indexOf('exact_revision != s.revision') < body.indexOf('s.sealed = true'));
});
test('read-only manifests return copied arrays, never actor-owned arrays', () => {
  for (const [name,next,array] of [
    ['selected_ids','selected_evidence','memory_ids'],
    ['selected_evidence','selected_excerpts','evidence_refs']]) {
    const body = method(name,next);
    assert.ok(body.includes('!s.sealed || task != s.task_id'));
    assert.ok(body.includes('exact_revision != s.revision'));
    assert.ok(body.includes('new Array<String>()'));
    assert.ok(body.includes('s.' + array));
    assert.ok(body.includes('return Ok(copy);'));
    assert.doesNotMatch(body, new RegExp('return\\s+s\\.' + array + '\\s*;'));
  }
});
test('observation and actor initialization are scoped, without reset', () => {
  const begin = method('begin','stage_reference');
  assert.ok(begin.includes('s.started || task == "" || exact_revision == ""'));
  assert.ok(begin.includes('s.started = true'));
  const count = method('current_count');
  assert.ok(count.includes('!s.started || task != s.task_id'));
  assert.ok(count.includes('exact_revision != s.revision'));
  assert.ok(count.includes('return Ok(s.memory_ids.size);'));
  assert.equal((text.match(/\bs\.started\s*=\s*false\b/g) || []).length, 0);
});
