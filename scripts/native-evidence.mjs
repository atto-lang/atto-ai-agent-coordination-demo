// Receipt consistency checks, not authentication of an untrusted executor.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const positive_files = Object.freeze([
  'src/agent_coordinator.ores', 'src/agent_registry.ores',
  'src/decision_gate.ores', 'src/decision_tree.ores',
  'src/evidence_ledger.ores', 'src/knowledge_cache.ores',
  'src/knowledge_graph.ores', 'src/workflow.ores',
  'tests/guest/agent_pipeline.ores', 'tests/guest/direct_agent_hop.ores'
]);
export const negative_file = 'tests/guest/negative/wrong_actor_mail_type.ores';
export const guest_names = Object.freeze(['agent_pipeline', 'direct_agent_hop']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const require = (ok, reason) => { if (!ok) throw Error(reason); };

export function verify_native_record(script, record, context) {
  const { compiler_head, compiler_tree, root } = context;
  require(/^[a-f0-9]{40}$/.test(compiler_head) && /^[a-f0-9]{40}$/.test(compiler_tree),
    'invalid expected compiler identity');
  require(record?.passed === true && record.compiler_source_head === compiler_head &&
    record.compiler_source_tree === compiler_tree, 'compiler identity/result mismatch');
  const hash_file = path => sha256(readFileSync(join(root, path)));
  const success = item => item?.passed === true && item.exit_code === 0 && item.signal === null;
  if (script === 'check-native-actors.mjs') {
    require(record.checked === positive_files.length && record.required === positive_files.length &&
      Array.isArray(record.outcomes) && record.outcomes.length === positive_files.length,
      'incomplete positive checks');
    for (const [index, file] of positive_files.entries()) {
      const item = record.outcomes[index];
      require(success(item) && item.file === file && item.source_sha256 === hash_file(file),
        'positive fixture identity or execution mismatch: ' + file);
    }
    const item = record.negative;
    require(item?.passed === true && item.file === negative_file &&
      item.source_sha256 === hash_file(negative_file) &&
      Number.isInteger(item.exit_code) && item.exit_code > 0 && item.signal === null &&
      item.expected_type_error === 'ActorRef.send mailbox value' &&
      typeof item.diagnostic === 'string' && item.diagnostic.includes(item.expected_type_error),
      'targeted negative fixture evidence missing');
  } else if (script === 'run-native-guest.mjs') {
    require(record.cases_required === guest_names.length && record.cases_executed === guest_names.length &&
      Array.isArray(record.results) && record.results.length === guest_names.length,
      'incomplete guest runs');
    for (const [index, name] of guest_names.entries()) {
      const item = record.results[index];
      const oracle_hash = hash_file('tests/guest/' + name + '.stdout');
      require(success(item) && item.name === name && item.error === null && item.stdout_exact === true &&
        item.source_sha256 === hash_file('tests/guest/' + name + '.ores') &&
        item.oracle_sha256 === oracle_hash && item.stdout_sha256 === oracle_hash,
        'guest identity or stdout evidence mismatch: ' + name);
    }
  } else throw Error('unknown native gate');
}
