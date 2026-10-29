import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { create_local_replay_claims } from '../reference/local-replay-claims.mjs';
import { create_signed_evidence_verifier, canonical_evidence_payload } from '../reference/signed-evidence-verifier.mjs';

const temp = () => mkdtempSync(join(tmpdir(),'ores-claims-'));
test('persists unique claim across separate store instances and rejects replay', async () => {
 const dir=temp(); try {
  const a=create_local_replay_claims(dir), b=create_local_replay_claims(dir);
  assert.equal(await a('issuer-a','id-1'),true);
  assert.equal(await b('issuer-a','id-1'),false);
  assert.equal(await b('issuer-a','id-2'),true);
  assert.equal(readdirSync(dir).length,2);
  assert.equal(statSync(join(dir,readdirSync(dir)[0])).mode & 0o077,0);
 } finally {rmSync(dir,{recursive:true,force:true})}
});
test('single-host CAS rejects racing attempts with exactly one winner', async () => {
 const dir=temp(); try {
  const a=create_local_replay_claims(dir), b=create_local_replay_claims(dir);
  const results=await Promise.all([a('issuer','same'),b('issuer','same')]);
  assert.deepEqual(results.sort(),[false,true]);
 } finally {rmSync(dir,{recursive:true,force:true})}
});
test('rejects symlink directory and untrusted identifiers', async () => {
 const dir=temp();const link=join(dir,'link');try{
  symlinkSync(dir,link,'dir'); assert.throws(()=>create_local_replay_claims(link),/non-symlink/);
  const claim=create_local_replay_claims(dir);
  assert.equal(await claim('issuer','../../unsafe'),true); // hashed; cannot escape
  assert.equal(await claim('issuer','contains space'),false);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('durable signed verifier denies reusing receipt after a new verifier instance', async () => {
 const dir=temp();try{
  const {privateKey, publicKey}=generateKeyPairSync('ed25519');
  const now=1800000000000;
  const scope={tenant_id:'tenant',task_id:'task',exact_revision:'a'.repeat(40),
    memory_id:'mem',evidence_ref:'source:1',excerpt_sha256:'b'.repeat(64)};
  const p={version:1,issuer:'issuer',audience:'oreslang.context.data.v1',key_id:'key',
    receipt_id:'one-use',...scope,not_before_ms:now-10,expires_at_ms:now+1000};
  const body=canonical_evidence_payload(p);
  const token={key_id:'key',payload_base64url:body.toString('base64url'),
    signature_base64url:sign(null,Buffer.concat([Buffer.from('oreslang.context-evidence.v1\0'),body]),privateKey).toString('base64url')};
  const make=()=>create_signed_evidence_verifier({trustedReceipts:async()=>token,keys:{key:publicKey},
    issuer:'issuer',now:()=>now,claimReceipt:create_local_replay_claims(dir),requireDurable:true});
  assert.deepEqual(await make()(scope),{authorized:true,...scope});
  assert.equal(await make()(scope),null);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('production flag requires durable claim function', () => {
 assert.throws(()=>create_signed_evidence_verifier({trustedReceipts:async()=>null,keys:{key:generateKeyPairSync('ed25519').publicKey},issuer:'issuer',requireDurable:true}),/required/);
});
