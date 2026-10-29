// Structural checks ONLY. They are not a parser, behavioral test, or guest CI.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const modules = [
  ['memory_ingestion', 'MemoryIngestionActor', ['ingest','acknowledge','pending']],
  ['memory_extraction', 'MemoryExtractionActor', ['stage','finish','forwarded_excerpt']],
  ['memory_verification', 'MemoryVerificationActor', ['propose','resolve','supersede','verified_content']],
  ['memory_invalidation', 'MemoryInvalidationActor', ['register','advance','is_current']],
  ['memory_index', 'MemoryIndexActor', ['link','find']],
  ['memory_retrieval', 'MemoryRetrievalActor', ['publish','withdraw','recall_ids','read']],
  ['context_assembly', 'ContextAssemblyActor', ['begin','add','seal','selected_ids','selected_excerpts','selected_evidence']],
  ['memory_consolidation', 'MemoryConsolidationActor', ['link_duplicate','resolve']],
  ['memory_checkpoint_manifest', 'MemoryCheckpointManifestActor', ['record','locate']]
];
const source = (name) => readFileSync(new URL('../src/memory/' + name + '.ores', import.meta.url), 'utf8');
const mustContain = (name, literals) => {
  const text = source(name);
  for (const literal of literals) {
    assert.ok(text.includes(literal), name + ' missing required guard: ' + literal);
  }
};

for (const [file, actor, methods] of modules) {
  test(file + ' has native userland actor declaration and entrypoints', () => {
    const text = source(file);
    assert.match(text, new RegExp('^define\\s+isolated\\s+actor\\s+' + actor + '\\s+as', 'm'));
    assert.equal((text.match(/^define isolated actor /gm) || []).length, 1);
    for (const method of methods) {
      assert.ok(text.includes('pub ' + method + '('), actor + '.' + method + ' missing');
    }
    assert.doesNotMatch(text, /\b(?:System\.|java\.|python3?|subprocess)\b/);
  });
}
test('ingestion is bounded, idempotent and acknowledges once', () => {
  mustContain('memory_ingestion', [
    's.event_ids.size >= 512',
    'if existing == event_id;',
    's.acknowledged[index]',
    's.digests[index] != digest'
  ]);
});
test('extraction never promotes a claim to verified status', () => {
  mustContain('memory_extraction', [
    's.candidate_ids.size >= 1024',
    's.states[i] != 0',
    's.states[i] = 1',
    's.states[i] = 2'
  ]);
});
test('verification resolves a candidate only once and keeps superseded facts', () => {
  mustContain('memory_verification', [
    's.memory_ids.size >= 2048',
    's.states[i] != 0',
    's.states[a] != 1 || s.states[b] != 1',
    's.states[a] = 3',
    's.states[i] != 1'
  ]);
});
test('head invalidation is compare-and-swap, revision and epoch pinned', () => {
  mustContain('memory_invalidation', [
    's.repositories.size >= 128',
    's.revisions[i] != expected_revision',
    's.generations[i] != expected_generation',
    's.revisions[i] == revision',
    's.generations[i] == generation'
  ]);
});
test('index and recall are scoped and capped', () => {
  mustContain('memory_index', [
    's.memory_ids.size >= 4096',
    's.revisions[i] == revision',
    'limit < 1 || limit > 32'
  ]);
  mustContain('memory_retrieval', [
    's.ids.size >= 1024',
    's.active[i] = false',
    's.revisions[i] == revision',
    'limit < 1 || limit > 16',
    's.evidence_refs[i] != evidence_ref'
  ]);
});
test('context packaging enforces fixed token estimate and seals output', () => {
  mustContain('context_assembly', [
    'token_budget > 16384',
    's.memory_ids.size >= 24',
    'estimated_tokens > s.remaining',
    's.remaining = s.remaining - estimated_tokens',
    's.sealed = true',
    'if !s.sealed'
  ]);
});
test('consolidation prevents direct alias cycles/chains', () => {
  mustContain('memory_consolidation', [
    'alias_id == canonical_id',
    's.canonicals[i] == alias_id',
    'existing == canonical_id',
    's.aliases.size >= 512'
  ]);
});
test('checkpoint manifest records monotonic external storage pointers only', () => {
  mustContain('memory_checkpoint_manifest', [
    'last_applied_event <= s.last_event_sequence',
    's.manifest_generation >= 2147483646',
    'checksum_expected != s.checksum',
    'event_sequence != s.last_event_sequence'
  ]);
});

import { auditActorSource } from '../scripts/actor-state-audit.mjs';
for (const [file] of modules) {
  test(file + ' has one state schema, scoped loans and critical writes', () => {
    const check = auditActorSource(source(file));
    assert.deepEqual(check.problems, [], JSON.stringify(check));
    assert.ok(check.writes > 0);
  });
}
