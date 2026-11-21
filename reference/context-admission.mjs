// Reference ingress guard for untrusted context excerpts; NOT an Oreslang runtime.
// A trusted host must supply a real tokenizer and authenticated evidence verifier.
// Caller-reported token counts are deliberately not accepted.
import { createHash } from 'node:crypto';

const MAX_EXCERPTS = 24;
const MAX_EXCERPT_BYTES = 4096;
const MAX_CONTEXT_BYTES = 65536;
const MAX_TOKEN_BUDGET = 16384;
const MAX_PENDING_VERIFICATIONS = 8;

const scopedId = value => typeof value === 'string' &&
  /^[a-zA-Z0-9_.:@/-]{1,128}$/.test(value);
const evidenceId = value => typeof value === 'string' &&
  /^[a-zA-Z0-9_.:@/#-]{1,256}$/.test(value);
const gitSha = value => typeof value === 'string' && /^[a-fA-F0-9]{40}$/.test(value);

function wellFormedUnicode(text) {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function closedDataRecord(value, keys) {
  // Snapshot own data descriptors WITHOUT property reads: Proxy.get and
  // accessor getters must never run in the admission authority path.
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length ||
        own.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
    const snapshot = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
          descriptor.enumerable !== true) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch { return null; }
}

// No parser-based or prompt-text check can grant tool permissions. The output is DATA.
export function create_context_admission({ tenant_id, task_id, exact_revision, token_budget,
  tokenizer_id, countTokens, verifyEvidence }) {
  if (!scopedId(tenant_id) || !scopedId(task_id) || !gitSha(exact_revision) ||
      !scopedId(tokenizer_id) || !Number.isSafeInteger(token_budget) ||
      token_budget < 1 || token_budget > MAX_TOKEN_BUDGET ||
      typeof countTokens !== 'function' || typeof verifyEvidence !== 'function') {
    throw new TypeError('trusted scope, pinned tokenizer and evidence verifier required');
  }

  let entries = [];
  let sealed = false;
  let pending = 0;
  let lastMeasure = null;

  const serialize = records => JSON.stringify({
    schema_version: 1,
    classification: 'untrusted_context_data',
    tenant_id, task_id, exact_revision,
    records: records.map(({ memory_id, evidence_ref, excerpt, excerpt_sha256 }) =>
      ({ memory_id, evidence_ref, excerpt_sha256, excerpt }))
  });

  const measure = records => {
    const context_json = serialize(records);
    const utf8_bytes = Buffer.byteLength(context_json, 'utf8');
    if (utf8_bytes > MAX_CONTEXT_BYTES) return null;
    let tokens;
    try { tokens = countTokens(context_json); } catch { return null; }
    if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > token_budget) return null;
    return { context_json, utf8_bytes, tokens };
  };

  // Async attestation may complete out of order. Recheck state AFTER awaiting it.
  const add = async candidate => {
    if (sealed || pending >= MAX_PENDING_VERIFICATIONS) return false;
    const clean = closedDataRecord(candidate, ['memory_id', 'evidence_ref', 'excerpt']);
    if (!clean) return false;
    const { memory_id, evidence_ref, excerpt } = clean;
    if (!scopedId(memory_id) || !evidenceId(evidence_ref) ||
        typeof excerpt !== 'string' || excerpt.length === 0 ||
        !wellFormedUnicode(excerpt) ||
        Buffer.byteLength(excerpt, 'utf8') > MAX_EXCERPT_BYTES ||
        entries.length >= MAX_EXCERPTS || entries.some(r => r.memory_id === memory_id)) return false;

    const excerpt_sha256 = createHash('sha256').update(excerpt, 'utf8').digest('hex');
    const request = Object.freeze({ tenant_id, task_id, exact_revision,
      memory_id, evidence_ref, excerpt_sha256 });
    pending++;
    let proof;
    try { proof = await verifyEvidence(request); }
    catch { return false; }
    finally { pending--; }

    // The proof is valid ONLY if the trusted verifier independently authenticates it.
    // The *trusted verifier*, not the model, returns a closed data-only proof.
    // A getter, Proxy trap, or injected field cannot become approval.
    const checked = closedDataRecord(proof, ['authorized', 'tenant_id', 'task_id',
        'exact_revision', 'memory_id', 'evidence_ref', 'excerpt_sha256']);
    if (!checked) return false;
    if (checked.authorized !== true ||
        checked.tenant_id !== tenant_id || checked.task_id !== task_id ||
        checked.exact_revision !== exact_revision || checked.memory_id !== memory_id ||
        checked.evidence_ref !== evidence_ref || checked.excerpt_sha256 !== excerpt_sha256 ||
        sealed || entries.length >= MAX_EXCERPTS ||
        entries.some(r => r.memory_id === memory_id)) return false;

    const next = [...entries, Object.freeze({ memory_id, evidence_ref, excerpt, excerpt_sha256 })];
    const metrics = measure(next);
    if (!metrics) return false;
    entries = next;
    lastMeasure = metrics;
    return true;
  };

  const seal = () => {
    if (sealed || pending !== 0) return false;
    // Even zero records must be serialized and measured at the actual seal boundary.
    const metrics = measure(entries);
    if (!metrics) return false;
    lastMeasure = metrics;
    sealed = true;
    return true;
  };

  const selected_context = () => {
    if (!sealed) return null;
    return Object.freeze({
      context_json: lastMeasure.context_json,
      utf8_bytes: lastMeasure.utf8_bytes,
      measured_tokens: lastMeasure.tokens,
      tokenizer_id,
      selected_ids: Object.freeze(entries.map(r => r.memory_id))
    });
  };

  return Object.freeze({ add, seal, selected_context });
}
