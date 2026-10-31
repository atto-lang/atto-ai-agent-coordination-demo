// Trusted HOST reference adapter, not native Oreslang or a tool-execution capability.
// Ed25519 context-evidence attestations do not grant commit/deploy permissions.
import { createPublicKey, verify as ed25519Verify } from 'node:crypto';

const FIELDS = ['version','issuer','audience','key_id','receipt_id','tenant_id','task_id',
  'exact_revision','memory_id','evidence_ref','excerpt_sha256','not_before_ms','expires_at_ms'];
const ID = /^[a-zA-Z0-9_.:@/-]{1,128}$/;
const REF = /^[a-zA-Z0-9_.:@/#-]{1,256}$/;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const DOMAIN = Buffer.from('oreslang.context-evidence.v1\0', 'utf8');

function snapshot(input, fields) {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== fields.length || keys.some(k => typeof k !== 'string' || !fields.includes(k))) return null;
    const copy = Object.create(null);
    for (const key of fields) {
      const d = Object.getOwnPropertyDescriptor(input, key);
      if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) return null;
      copy[key] = d.value;
    }
    return copy;
  } catch { return null; }
}

export function canonical_evidence_payload(payload) {
  const p = snapshot(payload, FIELDS);
  if (!p || p.version !== 1 || p.audience !== 'oreslang.context.data.v1' ||
      ![p.issuer,p.key_id,p.receipt_id,p.tenant_id,p.task_id,p.memory_id].every(x => typeof x === 'string' && ID.test(x)) ||
      typeof p.evidence_ref !== 'string' || !REF.test(p.evidence_ref) ||
      typeof p.exact_revision !== 'string' || !SHA.test(p.exact_revision) ||
      typeof p.excerpt_sha256 !== 'string' || !DIGEST.test(p.excerpt_sha256) ||
      !Number.isSafeInteger(p.not_before_ms) || !Number.isSafeInteger(p.expires_at_ms) ||
      p.not_before_ms < 0 || p.expires_at_ms <= p.not_before_ms ||
      p.expires_at_ms - p.not_before_ms > 300_000) return null;
  return Buffer.from(JSON.stringify(Object.fromEntries(FIELDS.map(k => [k, p[k]]))), 'utf8');
}

// trustedReceipts is an application-injected source of signed envelopes.
// It may be backed by untrusted transport: the signature, never the transport,
// determines authenticity. This adapter consumes receipt IDs in one process;
// across restarts, a durable shared replay ledger is REQUIRED.
export function create_signed_evidence_verifier({ trustedReceipts, keys, issuer,
    now = Date.now, max_receipts = 4096, claimReceipt = null, requireDurable = false }) {
  if (typeof trustedReceipts !== 'function' || typeof now !== 'function' ||
      typeof issuer !== 'string' || !ID.test(issuer) ||
      !Number.isSafeInteger(max_receipts) || max_receipts < 1 || max_receipts > 4096 ||
      !keys || Object.getPrototypeOf(keys) !== Object.prototype ||
      (claimReceipt !== null && typeof claimReceipt !== 'function') ||
      (requireDurable && typeof claimReceipt !== 'function')) {
    throw new TypeError('trusted receipt source, issuer, and key registry required');
  }
  const keyIds = Object.keys(keys);
  if (!keyIds.length || keyIds.length > 16 || keyIds.some(x => !ID.test(x)))
    throw new TypeError('invalid signing-key registry');
  const publicKeys = new Map(keyIds.map(id => {
    const supplied = keys[id];
    const key = supplied?.type === 'public' ? supplied : createPublicKey(supplied);
    if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('Ed25519 public key required');
    return [id, key];
  }));
  const consumed = new Set();
  // Reserve capacity before any asynchronous receipt fetch or durable claim.
  // Otherwise concurrent signed receipts can bypass max_receipts.
  let pending = 0;

  return async function verifyEvidence(request) {
    const scope = snapshot(request, ['tenant_id','task_id','exact_revision',
      'memory_id','evidence_ref','excerpt_sha256']);
    if (!scope || typeof scope.tenant_id !== 'string' || !ID.test(scope.tenant_id) ||
        typeof scope.task_id !== 'string' || !ID.test(scope.task_id) ||
        typeof scope.memory_id !== 'string' || !ID.test(scope.memory_id) ||
        typeof scope.evidence_ref !== 'string' || !REF.test(scope.evidence_ref) ||
        typeof scope.exact_revision !== 'string' || !SHA.test(scope.exact_revision) ||
        typeof scope.excerpt_sha256 !== 'string' || !DIGEST.test(scope.excerpt_sha256) ||
        consumed.size + pending >= max_receipts) return null;
    pending++;
    try {
    let envelope;
    try { envelope = await trustedReceipts(Object.freeze({ ...scope })); }
    catch { return null; }
    const e = snapshot(envelope, ['key_id','payload_base64url','signature_base64url']);
    if (!e || typeof e.key_id !== 'string' || !publicKeys.has(e.key_id) ||
        typeof e.payload_base64url !== 'string' || !B64URL.test(e.payload_base64url) ||
        e.payload_base64url.length > 3000 || typeof e.signature_base64url !== 'string' ||
        !B64URL.test(e.signature_base64url) || e.signature_base64url.length > 120) return null;
    try {
      const body = Buffer.from(e.payload_base64url, 'base64url');
      const signature = Buffer.from(e.signature_base64url, 'base64url');
      if (body.length > 2048 || signature.length !== 64 ||
          body.toString('base64url') !== e.payload_base64url ||
          signature.toString('base64url') !== e.signature_base64url) return null;
      const payload = JSON.parse(body.toString('utf8'));
      const canonical = canonical_evidence_payload(payload);
      if (!canonical || !canonical.equals(body) || payload.key_id !== e.key_id ||
          payload.issuer !== issuer || consumed.has(payload.receipt_id)) return null;
      const time = now();
      if (!Number.isSafeInteger(time) || time < payload.not_before_ms || time >= payload.expires_at_ms) return null;
      for (const key of Object.keys(scope)) if (payload[key] !== scope[key]) return null;
      if (!ed25519Verify(null, Buffer.concat([DOMAIN, body]), publicKeys.get(e.key_id), signature)) return null;
      // Single-process replay rejection is atomic after await; do not cache
      // any successful claim before signature and scope validation.
      if (consumed.has(payload.receipt_id) || consumed.size >= max_receipts) return null;
      // A host-owned durable claim must be atomic, linearizable, and fail closed.
      // The bundled local-file adapter is SINGLE-HOST only.
      if (claimReceipt && await claimReceipt(payload.issuer, payload.receipt_id) !== true) return null;
      consumed.add(payload.receipt_id);
      return Object.freeze({ authorized: true, ...scope });
    } catch { return null; }
    } finally { pending--; }
  };
}
