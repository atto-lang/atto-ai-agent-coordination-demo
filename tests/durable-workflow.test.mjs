import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DurableWorkflow, reconcile_pending } from '../reference/durable-workflow.mjs';
const sha = 'a'.repeat(40), digest = createHash('sha256').update('tool-payload').digest('hex');
const dir = () => mkdtempSync(join(tmpdir(), 'ores-agent-'));

test('full ordered workflow persists, restores and rejects double completion', () => {
  const d = dir(), f = new DurableWorkflow(d, 'work-1', sha);
  f.begin(); f.approve(); f.intent('op-1', digest); f.acknowledge('op-1', 'receipt-1'); f.finish();
  const recovered = new DurableWorkflow(d, 'work-1', sha);
  assert.equal(recovered.state.status, 'finished');
  assert.equal(recovered.state.completed['op-1'], 'receipt-1');
  assert.equal(recovered.state.seq, 5);
  assert.throws(() => recovered.acknowledge('op-1', 'receipt-2'), /bad receipt/);
  assert.throws(() => recovered.finish(), /bad completion/);
});

test('refuses unauthorized effects, stale writer, duplicate keys and stale commit', () => {
  const d = dir(), first = new DurableWorkflow(d, 'work-1', sha), stale = new DurableWorkflow(d, 'work-1', sha);
  assert.throws(() => first.intent('op-1', digest), /effect not authorized/);
  first.begin();
  assert.throws(() => stale.begin(), /stale writer/);
  assert.throws(() => new DurableWorkflow(d, 'work-1', 'b'.repeat(40)), /revision mismatch/);
  first.approve();
  assert.throws(() => first.intent('__proto__', digest), /bad idempotency key/);
  first.intent('op-1', digest);
  assert.throws(() => first.intent('op-1', digest), /duplicate effect key/);
  assert.throws(() => first.finish(), /unresolved effect/);
  assert.throws(() => first.cancel(), /unresolved effect/);
});

test('unknown external effect fails closed, no blind replay', () => {
  const d = dir(), f = new DurableWorkflow(d, 'work-1', sha);
  f.begin(); f.approve(); f.intent('effect', digest);
  const out = reconcile_pending(f, { lookup: () => ({ status: 'unknown' }) });
  assert.equal(out.intents.effect.outcome, 'uncertain');
  assert.throws(() => f.cancel(), /unresolved effect/);
  assert.throws(() => f.finish(), /unresolved effect/);
  assert.throws(() => f.acknowledge('effect', 'receipt'), /bad receipt/);
  reconcile_pending(f, { lookup: () => ({ status: 'committed', receipt: 'verified-later' }) });
  f.finish();
  assert.equal(f.state.completed.effect, 'verified-later');
});

test('authoritative lookup reconciles known committed effect after restart', () => {
  const d = dir(), before = new DurableWorkflow(d, 'work-1', sha);
  before.begin(); before.approve(); before.intent('effect', digest);
  const recovered = new DurableWorkflow(d, 'work-1', sha);
  reconcile_pending(recovered, { lookup: (key, hash) => {
    assert.equal(key, 'effect'); assert.equal(hash, digest);
    return { status: 'committed', receipt: 'remote-01' };
  }});
  recovered.finish();
  assert.equal(new DurableWorkflow(d, 'work-1', sha).state.completed.effect, 'remote-01');
});

test('journal corruption and uncommitted record truncation block recovery', () => {
  const d = dir(), f = new DurableWorkflow(d, 'work-1', sha);
  f.begin();
  appendFileSync(f.path, '{"seq":2');
  assert.throws(() => new DurableWorkflow(d, 'work-1', sha), /unterminated/);
  const d2 = dir(), g = new DurableWorkflow(d2, 'work-2', sha);
  g.begin(); const body = readFileSync(g.path, 'utf8');
  writeFileSync(g.path, body.replace('BEGIN', 'BAGIN'));
  assert.throws(() => new DurableWorkflow(d2, 'work-2', sha), /corrupt/);
});

test('subprocess SIGKILL after intent is recovered as pending, not completed', () => {
  const d = dir();
  const code = `import { DurableWorkflow } from ${JSON.stringify(new URL('../reference/durable-workflow.mjs', import.meta.url).href)};
const f = new DurableWorkflow(${JSON.stringify(d)}, 'work-1', '${sha}');
f.begin(); f.approve(); f.intent('effect', '${digest}');
process.kill(process.pid, 'SIGKILL');`;
  const killed = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
  assert.equal(killed.signal, 'SIGKILL');
  const s = new DurableWorkflow(d, 'work-1', sha).state;
  assert.equal(s.seq, 3);
  assert.equal(s.intents.effect.outcome, 'pending');
  assert.equal(s.completed.effect, undefined);
});
