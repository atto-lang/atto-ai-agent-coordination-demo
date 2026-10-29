// Source-structure regression only, NOT native Oreslang execution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditActorSource } from '../scripts/actor-state-audit.mjs';
const source = readFileSync(new URL('../src/evaluation/retrieval_scorecard.ores', import.meta.url), 'utf8');
const section = (name, next) => {
  const begin = source.indexOf('pub ' + name + '(');
  const end = next ? source.indexOf('pub ' + next + '(', begin) : source.lastIndexOf('\nend');
  assert.ok(begin >= 0 && end > begin);
  return source.slice(begin, end);
};
test('native scorecard actor has a sealed single-owner schema with source-safe loans', () => {
  const result = auditActorSource(source);
  assert.deepEqual(result.problems, [], JSON.stringify(result));
  assert.equal(result.actor, 'RetrievalScorecardActor');
  assert.equal(result.fields, 14);
  assert.equal(result.methods, 7);
  assert.equal(result.writes, 3);
  assert.equal(result.reads, 4);
});
test('records carry exact scope, CAS, bounded strategy and total fixture caps', () => {
  const record = section('record', 'seal');
  for (const token of [
    'tenant != s.tenant_id', 'run != s.run_id', 'model != s.model_id',
    'exact_corpus_revision != s.corpus_revision',
    'strategy < 1 || strategy > 4',
    's.case_ids.size >= s.max_results',
    'expected_generation != s.generation',
    's.generation >= 2147483646'
  ]) assert.ok(record.includes(token), token);
});
test('duplicate case/strategy and receipt replay rejected before counting', () => {
  const record = section('record', 'seal');
  assert.ok(record.includes('previous == case_id &&'));
  assert.ok(record.includes('s.case_strategies[i] == strategy'));
  assert.ok(record.includes('s.receipt_refs[i] == evaluation_receipt'));
  assert.ok(record.indexOf('s.receipt_refs[i] == evaluation_receipt') <
    record.indexOf('s.totals[index] = s.totals[index] + 1'));
});
test('grounding score requires correct answer, matching citation and no tool request', () => {
  const record = section('record', 'seal');
  assert.ok(record.includes('answer_correct && citation_grounded && !attempted_tool'));
  assert.ok(record.includes('if attempted_tool; then'));
  assert.ok(record.includes('s.unsafe_attempts[index] = s.unsafe_attempts[index] + 1'));
});
test('aggregate counters are invisible until sealed', () => {
  for (const name of ['total_for','grounded_for','unsafe_for']) {
    const body = section(name, name === 'total_for' ? 'grounded_for' : name === 'grounded_for' ? 'unsafe_for' : 'current_generation');
    assert.ok(body.includes('!s.sealed || strategy < 1 || strategy > 4'));
    assert.ok(body.includes('return Err('));
  }
  const seal = section('seal', 'total_for');
  assert.ok(seal.includes('s.case_ids.size == 0'));
  assert.ok(seal.includes('s.sealed = true;'));
});
test('scorecard has no network, model invocation or special graph syntax', () => {
  assert.doesNotMatch(source, /self\.(?!handle_state\()/);
  assert.doesNotMatch(source, /\b(?:await|spawn|fetch|http|grpc|tool_dispatch|cuda)\s*\(/);
  assert.ok(source.includes('Reports are only as trustworthy'));
});
