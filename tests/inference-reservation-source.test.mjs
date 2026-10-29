// Structural checks only. No native parser, typecheck, runtime or GPU use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditActorSource } from '../scripts/actor-state-audit.mjs';

const source = readFileSync(new URL('../src/inference/inference_reservation.ores', import.meta.url), 'utf8');
const extract = (start, next) => {
  const a = source.indexOf('pub ' + start + '(');
  const b = next ? source.indexOf('pub ' + next + '(', a + 1) : source.lastIndexOf('\nend');
  assert.ok(a >= 0 && b > a, 'methods must be ordered and present');
  return source.slice(a, b);
};
test('native actor owns sealed state with scoped critical loans and no escaped arrays', () => {
  const audit = auditActorSource(source);
  assert.deepEqual(audit.problems, [], JSON.stringify(audit));
  assert.equal(audit.actor, 'InferenceReservationActor');
  assert.equal(audit.fields, 12);
  assert.equal(audit.methods, 8);
  assert.equal(audit.writes, 4);
  assert.equal(audit.reads, 4);
});
test('reservation rejects untrusted scope, stale generation, caps and duplicates', () => {
  const reserve = extract('reserve', 'release_verified');
  for (const token of [
    'tenant != s.tenant_id', 'model != s.model_id',
    'exact_revision != s.source_revision',
    'request_id == ""', 'expected_generation != s.generation',
    'requested_units < 1', 'requested_units > 65536',
    's.active_count >= s.max_concurrent',
    'requested_units > s.max_reserved_units - s.reserved_units',
    's.request_ids.size >= 4096', 's.generation >= 2147483646',
    'existing == request_id', 'return Ok(s.request_ids.size);'
  ]) assert.ok(reserve.includes(token), 'missing: ' + token);
  assert.ok(reserve.indexOf('requested_units > s.max_reserved_units') <
    reserve.indexOf('s.reserved_units = s.reserved_units + requested_units;'));
});
test('release requires exact ticket, scope, generation and single-use state', () => {
  const release = extract('release_verified', 'stop_accepting');
  for (const token of [
    'ticket < 1 || ticket > s.request_ids.size',
    's.request_ids[index] != request_id', 's.request_states[index] != 1',
    'expected_generation != s.generation',
    's.request_states[index] = 2',
    's.active_count = s.active_count - 1',
    's.reserved_units = s.reserved_units - s.request_units[index]'
  ]) assert.ok(release.includes(token), 'missing: ' + token);
  assert.ok(release.indexOf('s.request_states[index] != 1') <
    release.indexOf('s.request_states[index] = 2'));
});
test('stop admits no new work but keeps reservations and excludes silent reclamation', () => {
  const stop = extract('stop_accepting', 'current_generation');
  assert.ok(stop.includes('s.phase != 1'));
  assert.ok(stop.includes('s.phase = 2;'));
  assert.doesNotMatch(stop, /(?:s\.active_count|s\.reserved_units)\s*=/);
  assert.ok(source.includes('Unknown remote outcomes'));
});
test('state is pure Oreslang and never pretends to call an inference server', () => {
  assert.doesNotMatch(source, /\b(?:fetch|http|grpc|CUDA|cuda|System\.|java\.|spawn|await)\s*\(/);
  assert.doesNotMatch(source, /self\.(?!handle_state\()/);
  assert.ok(source.includes('This reserves declared request units'));
});

test('all observation methods reject foreign tenant/model/revision before returning counters', () => {
  for (const name of ['current_generation', 'in_flight', 'reserved_capacity', 'current_phase']) {
    const next = ({ current_generation: 'in_flight', in_flight: 'reserved_capacity',
      reserved_capacity: 'current_phase' })[name];
    const body = extract(name, next);
    for (const guard of ['s.phase == 0', 'tenant != s.tenant_id',
      'model != s.model_id', 'exact_revision != s.source_revision']) {
      assert.ok(body.includes(guard), name + ' must reject ' + guard);
    }
    assert.ok(body.includes('return Err("foreign or unconfigured'));
    assert.ok(body.includes('return Ok('));
  }
});
