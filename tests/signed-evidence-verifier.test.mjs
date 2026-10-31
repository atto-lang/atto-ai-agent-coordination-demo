import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { canonical_evidence_payload, create_signed_evidence_verifier } from '../reference/signed-evidence-verifier.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const badKey = generateKeyPairSync('ed25519').privateKey;
const issuer = 'trusted-memory-verifier';
const nowTime = 1_800_000_000_000;
const DOMAIN = Buffer.from('oreslang.context-evidence.v1\0', 'utf8');
const scope = Object.freeze({ tenant_id: 'tenant-a', task_id: 'task-a', exact_revision: 'a'.repeat(40),
  memory_id: 'mem-a', evidence_ref: 'sha256:abc123',
  excerpt_sha256: createHash('sha256').update('verified excerpt').digest('hex') });
const payload = (overrides = {}) => ({ version: 1, issuer, audience: 'oreslang.context.data.v1',
  key_id: 'key-a', receipt_id: 'receipt-a', ...scope, not_before_ms: nowTime - 1000,
  expires_at_ms: nowTime + 60000, ...overrides });
const envelope = (p = payload(), key = privateKey) => {
  const bytes = canonical_evidence_payload(p);
  if (!bytes) throw Error('invalid test payload');
  return { key_id: p.key_id, payload_base64url: bytes.toString('base64url'),
    signature_base64url: sign(null, Buffer.concat([DOMAIN, bytes]), key).toString('base64url') };
};
const make = (receipt = envelope(), options={}) => create_signed_evidence_verifier({
  trustedReceipts: async () => receipt, keys: { 'key-a': publicKey }, issuer,
  now: () => nowTime, ...options });

test('real Ed25519 signature verifies pinned context and single-use receipt', async () => {
  const verify = make();
  assert.deepEqual(await verify(scope), { authorized: true, ...scope });
  assert.equal(await verify(scope), null);
});
test('rejects wrong signer, tampered signature, malformed signature', async () => {
  assert.equal(await make(envelope(payload(), badKey))(scope), null);
  const modified = envelope(); const corrupted = Buffer.from(modified.signature_base64url, 'base64url'); corrupted[0] ^= 0x80; modified.signature_base64url = corrupted.toString('base64url');
  assert.equal(await make(modified)(scope), null);
  assert.equal(await make({ ...envelope(), signature_base64url: '$$$' })(scope), null);
});
test('denies cross-tenant, task, revision, memory, digest, reference and issuer confusion', async () => {
  for (const [key,value] of Object.entries({ tenant_id: 'tenant-b', task_id: 'task-b',
    exact_revision: 'b'.repeat(40), memory_id: 'mem-b',
    excerpt_sha256: '0'.repeat(64), evidence_ref: 'sha256:other', issuer: 'other-issuer' })) {
    assert.equal(await make(envelope(payload({ [key]: value })))(scope), null, key);
  }
});
test('denies expired, premature, overlong issuance and wrong audience', async () => {
  assert.equal(await make(envelope(payload({expires_at_ms:nowTime})))(scope), null);
  assert.equal(await make(envelope(payload({not_before_ms:nowTime+1,expires_at_ms:nowTime+200})))(scope), null);
  assert.equal(canonical_evidence_payload(payload({expires_at_ms:nowTime+900_000})), null);
  assert.equal(canonical_evidence_payload(payload({audience:'oreslang.deploy'})), null);
});
test('rejects token payload mutation and forged key ID even with a legitimate signature', async () => {
  const orig = envelope();
  const changed = Buffer.from(orig.payload_base64url,'base64url').toString().replace('tenant-a','tenant-b');
  assert.equal(await make({ ...orig,payload_base64url:Buffer.from(changed).toString('base64url') })(scope),null);
  assert.equal(await make({ ...orig,key_id:'unknown' })(scope),null);
});
test('rejects accessor/proxy envelopes and unknown fields without invoking getters', async () => {
  const getter = { ...envelope() };
  Object.defineProperty(getter, 'signature_base64url', { enumerable:true,get(){throw Error('getter ran')} });
  assert.equal(await make(getter)(scope),null);
  assert.equal(await make({ ...envelope(), authorized:true })(scope),null);
  const evil = new Proxy(envelope(),{ownKeys(){throw Error('proxy trap')}});
  assert.equal(await make(evil)(scope),null);
});
test('enforces bounded in-process replay storage without evicting earlier IDs', async () => {
  const items = [envelope(), envelope(payload({receipt_id:'receipt-b'}))];
  let i=0;
  const verifier = create_signed_evidence_verifier({
    trustedReceipts: async () => items[Math.min(i++,1)], keys:{'key-a':publicKey},
    issuer, now:()=>nowTime, max_receipts:1 });
  assert.ok(await verifier(scope));
  assert.equal(await verifier(scope),null);
});
test('fails closed on thrown receipt fetch and malformed scope', async () => {
  const v = make(envelope(),{trustedReceipts:async()=>{throw Error('backend offline')}});
  assert.equal(await v(scope),null);
  assert.equal(await make()({ ...scope, unknown:'spoof' }),null);
});
test('canonical byte encoding rejects noncanonical or extra fields', () => {
  assert.equal(canonical_evidence_payload({...payload(),privileged:true}),null);
  const a=canonical_evidence_payload(payload());
  assert.ok(Buffer.isBuffer(a));
  assert.equal(a.toString().includes('oreslang.deploy'),false);
});

test('concurrent distinct signed receipts cannot exceed max_receipts while a durable claim is pending', async () => {
  const firstClaimStarted = Promise.withResolvers();
  const allowFirstClaim = Promise.withResolvers();
  let receipts = 0;
  let claimAttempts = 0;
  const verify = create_signed_evidence_verifier({
    trustedReceipts: async () => envelope(payload({receipt_id:'concurrent-'+(++receipts)})),
    keys:{'key-a':publicKey}, issuer, now:()=>nowTime, max_receipts:1,
    claimReceipt: async () => {
      claimAttempts++;
      if (claimAttempts === 1) {
        firstClaimStarted.resolve();
        await allowFirstClaim.promise;
      }
      return true;
    }, requireDurable:true
  });
  const first = verify(scope);
  await firstClaimStarted.promise;
  try {
    assert.equal(await verify(scope), null, 'concurrent verifier must reject capacity overrun');
  } finally { allowFirstClaim.resolve(); }
  assert.deepEqual(await first, {authorized:true, ...scope});
  assert.equal(claimAttempts, 1, 'rejected parallel request must never reach durable claim');
  assert.equal(await verify(scope), null, 'consumed receipt capacity remains spent');
});

test('failed verification frees an in-flight reservation without consuming receipt capacity', async () => {
  let attempts=0;
  const verify = create_signed_evidence_verifier({
    trustedReceipts: async () => ++attempts === 1
      ? { ...envelope(), signature_base64url:'not_valid' }
      : envelope(payload({receipt_id:'recovered-receipt'})),
    keys:{'key-a':publicKey}, issuer, now:()=>nowTime, max_receipts:1
  });
  assert.equal(await verify(scope), null);
  assert.deepEqual(await verify(scope), {authorized:true, ...scope});
  assert.equal(await verify(scope), null);
});
