// TRUSTED HOST REFERENCE ONLY, NOT a native Oreslang implementation.
// Consumes UNTRUSTED reference-only ContextAssemblyActor manifest.
// Only this privileged host adapter may resolve excerpts and deliver to model.
// Neither this code nor a signed context receipt authorizes tool execution.
import { createHash } from 'node:crypto';
import { create_context_admission } from './context-admission.mjs';
import { create_signed_evidence_verifier } from './signed-evidence-verifier.mjs';

const scopedId = x => typeof x === 'string' && /^[A-Za-z0-9_.:@/-]{1,128}$/.test(x);
const evidenceRef = x => typeof x === 'string' && /^[A-Za-z0-9_.:@/#-]{1,256}$/.test(x);
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);

function dataRecord(value, names) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const own = Reflect.ownKeys(value);
    if (own.length !== names.length || own.some(x => typeof x !== 'string' || !names.includes(x))) return null;
    const out = Object.create(null);
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      out[key] = descriptor.value;
    }
    return out;
  } catch { return null; }
}
function primitiveArray(input, validate, limit) {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype ||
        input.length > limit || Reflect.ownKeys(input).length !== input.length + 1) return null;
    const out = [];
    for (let i = 0; i < input.length; i++) {
      const d = Object.getOwnPropertyDescriptor(input, String(i));
      if (!d || !Object.hasOwn(d, 'value') || !d.enumerable || !validate(d.value)) return null;
      out.push(d.value);
    }
    return out;
  } catch { return null; }
}

// All callbacks are provided by trusted host configuration, NEVER from agent
// input. A model-selected verifier/tokenizer/dispatcher defeats this contract.
export function create_trusted_manifest_dispatch({
  tenant_id, task_id, exact_revision, dispatch_id, tokenizer_id, token_budget,
  countTokens, trustedReceipts, keys, issuer, claimReceipt, claimDispatch,
  resolveExcerpt, authorizeDispatch, isCurrentRevision, submitModelData,
  now = Date.now
}) {
  if (!scopedId(tenant_id) || !scopedId(task_id) || !sha(exact_revision) ||
      !scopedId(dispatch_id) || !scopedId(tokenizer_id) ||
      [resolveExcerpt, authorizeDispatch, isCurrentRevision, submitModelData].some(x => typeof x !== 'function') ||
      typeof claimReceipt !== 'function' || typeof claimDispatch !== 'function')
    throw new TypeError('trusted manifest dispatch configuration required');

  const verifyEvidence = create_signed_evidence_verifier({
    trustedReceipts, keys, issuer, now, claimReceipt, requireDurable: true
  });
  const admission = create_context_admission({
    tenant_id, task_id, exact_revision, tokenizer_id, token_budget,
    countTokens, verifyEvidence
  });
  let invoked = false;

  // One attempt. Unknown remote outcomes are not retried, nor is a spent
  // signed receipt reused. Crashes still require external reconciliation.
  async function dispatch(manifest) {
    if (invoked) return false;
    invoked = true;
    const clean = dataRecord(manifest, ['task_id','exact_revision','memory_ids','evidence_refs']);
    if (!clean || clean.task_id !== task_id || clean.exact_revision !== exact_revision) return false;
    const memory_ids = primitiveArray(clean.memory_ids, scopedId, 24);
    const evidence_refs = primitiveArray(clean.evidence_refs, evidenceRef, 24);
    if (!memory_ids || !evidence_refs || memory_ids.length === 0 ||
        memory_ids.length !== evidence_refs.length ||
        new Set(memory_ids).size !== memory_ids.length) return false;

    const scope = Object.freeze({ tenant_id, task_id, exact_revision });
    for (let i = 0; i < memory_ids.length; i++) {
      const memory_id = memory_ids[i], evidence_ref = evidence_refs[i];
      const reference = Object.freeze({ ...scope, memory_id, evidence_ref });
      let response;
      try { response = await resolveExcerpt(reference); }
      catch { return false; }
      const data = dataRecord(response, ['memory_id','evidence_ref','excerpt']);
      if (!data || data.memory_id !== memory_id || data.evidence_ref !== evidence_ref) return false;
      if (!await admission.add({memory_id, evidence_ref, excerpt: data.excerpt})) return false;
    }
    if (!admission.seal()) return false;
    const context = admission.selected_context();
    if (!context) return false;
    // Host-selected logical dispatch identity, never taken from the manifest.
    // The digest pins the submitted bytes, not only a caller-declared count.
    const bound = Object.freeze({
      ...scope, dispatch_id, tokenizer_id,
      context_sha256: createHash('sha256').update(context.context_json, 'utf8').digest('hex'),
      utf8_bytes: context.utf8_bytes, measured_tokens: context.measured_tokens
    });
    try {
      if (await isCurrentRevision(bound) !== true) return false;
      if (await authorizeDispatch(bound) !== true) return false;
      // Atomic durable one-shot claim at the final host dispatch boundary.
      // Unknown outcomes stay claimed: never silently submit twice.
      // A claim implementation that only stores in process memory is NOT safe
      // for recovery or concurrent hosts; use storage-enforced uniqueness.
      if (await claimDispatch(bound) !== true) return false;
      // Untrusted model input is never an approval or a tool capability.
      // The trusted model service must have NO ambient privileged tools.
      await submitModelData(Object.freeze({
        classification: 'untrusted_context_data',
        tenant_id, task_id, exact_revision,
        context_json: context.context_json,
        utf8_bytes: context.utf8_bytes,
        measured_tokens: context.measured_tokens,
        tokenizer_id
      }));
      return true;
    } catch { return false; }
  }
  return Object.freeze({ dispatch });
}
