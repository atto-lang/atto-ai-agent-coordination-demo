// Node.js executable reference model, NOT Oreslang native guest code.
// Single-process/single-writer reference. A production runtime needs a fenced
// exclusive writer, authenticated policy, and a transactional storage adapter.
import { createHash } from 'node:crypto';
import { openSync, closeSync, readFileSync, writeSync, fsyncSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const hash = (x) => createHash('sha256').update(x).digest('hex');
const canonical = (x) => JSON.stringify(x);
function assert(condition, message) { if (!condition) throw Error(message); }
function fresh(id, revision) {
  return { id, revision, seq: 0, status: 'new', approved: false,
    intents: {}, completed: {}, last_hash: '0'.repeat(64) };
}
function apply(s, e) {
  switch (e.type) {
    case 'BEGIN':
      assert(s.status === 'new' && e.revision === s.revision, 'bad begin');
      s.status = 'planned'; break;
    case 'APPROVE':
      assert(s.status === 'planned' && e.revision === s.revision, 'bad approval');
      // An authenticated control plane MUST authorize this operation.
      s.approved = true; s.status = 'running'; break;
    case 'INTENT':
      assert(s.status === 'running' && s.approved, 'effect not authorized');
      assert(typeof e.key === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(e.key) &&
        !['__proto__', 'constructor', 'prototype'].includes(e.key),
        'bad idempotency key');
      assert(!Object.hasOwn(s.intents, e.key), 'duplicate effect key');
      assert(typeof e.digest === 'string' && /^[a-f0-9]{64}$/.test(e.digest), 'bad digest');
      s.intents[e.key] = { digest: e.digest, outcome: 'pending' }; break;
    case 'ACK':
      assert(s.status === 'running' && s.intents[e.key]?.outcome === 'pending', 'bad receipt');
      assert(typeof e.receipt === 'string' && e.receipt.length > 0, 'bad receipt ID');
      s.intents[e.key].outcome = 'committed'; s.completed[e.key] = e.receipt; break;
    case 'RESOLVE':
      assert(s.status === 'running' && s.intents[e.key]?.outcome === 'uncertain', 'bad resolution');
      assert(typeof e.receipt === 'string' && e.receipt.length > 0, 'bad receipt ID');
      s.intents[e.key].outcome = 'committed'; s.completed[e.key] = e.receipt; break;
    case 'UNKNOWN':
      assert(s.status === 'running' && s.intents[e.key]?.outcome === 'pending', 'bad unknown outcome');
      s.intents[e.key].outcome = 'uncertain'; break;
    case 'CANCEL':
      assert(s.status === 'planned' || s.status === 'running', 'bad cancellation');
      assert(Object.values(s.intents).every(x => x.outcome !== 'pending'), 'pending effect');
      s.status = 'cancelled'; break;
    case 'FINISH':
      assert(s.status === 'running', 'bad completion');
      assert(Object.values(s.intents).every(x => x.outcome === 'committed'), 'unresolved effect');
      s.status = 'finished'; break;
    default: throw Error('unknown journal event');
  }
}

export class DurableWorkflow {
  constructor(directory, id, revision) {
    assert(/^[a-zA-Z0-9_-]{1,96}$/.test(id), 'unsafe workflow ID');
    assert(/^[a-f0-9]{40}$/.test(revision), 'revision must be exact Git SHA');
    this.directory = resolve(directory); this.path = join(this.directory, id + '.journal');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.state = fresh(id, revision); this.replay();
  }
  replay() {
    let body;
    try { body = readFileSync(this.path, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return; throw e; }
    const lines = body.split('\n');
    assert(lines.at(-1) === '', 'torn or unterminated journal record');
    for (const line of lines.slice(0, -1)) {
      assert(line.length > 0 && line.length < 32768, 'invalid record length');
      const r = JSON.parse(line);
      assert(r.workflow_id === this.state.id && r.revision === this.state.revision,
        'journal identity/revision mismatch');
      assert(r.seq === this.state.seq + 1 && r.prev === this.state.last_hash,
        'journal sequence/hash chain mismatch');
      assert(r.hash === hash(canonical([r.workflow_id, r.revision, r.seq, r.prev, r.event])),
        'journal payload corrupt');
      apply(this.state, r.event);
      this.state.seq = r.seq; this.state.last_hash = r.hash;
    }
  }
  append(event) {
    const check = new DurableWorkflow(this.directory, this.state.id, this.state.revision);
    assert(check.state.seq === this.state.seq && check.state.last_hash === this.state.last_hash,
      'stale writer; external single-writer fencing is required');
    const after = structuredClone(this.state);
    apply(after, event);
    const seq = this.state.seq + 1, prev = this.state.last_hash;
    const record = { workflow_id: this.state.id, revision: this.state.revision,
      seq, prev, event };
    record.hash = hash(canonical([record.workflow_id, record.revision, seq, prev, event]));
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
    assert(bytes.length < 32768, 'record too large');
    const fd = openSync(this.path, 'a', 0o600);
    try {
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    after.seq = seq; after.last_hash = record.hash;
    this.state = after;
    return structuredClone(this.state);
  }
  begin() { return this.append({ type: 'BEGIN', revision: this.state.revision }); }
  // Caller MUST authenticate approval, CI evidence and actor capability first.
  approve() { return this.append({ type: 'APPROVE', revision: this.state.revision }); }
  intent(key, digest) { return this.append({ type: 'INTENT', key, digest }); }
  acknowledge(key, receipt) { return this.append({ type: 'ACK', key, receipt }); }
  unknown(key) { return this.append({ type: 'UNKNOWN', key }); }
  resolve(key, receipt) { return this.append({ type: 'RESOLVE', key, receipt }); }
  finish() { return this.append({ type: 'FINISH' }); }
  cancel() { return this.append({ type: 'CANCEL' }); }
  get_state() { return structuredClone(this.state); }
}

// An adapter may never automatically re-execute an uncertain effect. The
// adapter MUST provide authoritative query-by-key reconciliation, not a guess.
export function reconcile_pending(workflow, adapter) {
  assert(adapter && typeof adapter.lookup === 'function', 'authoritative lookup required');
  for (const [key, item] of Object.entries(workflow.state.intents)) {
    if (item.outcome !== 'pending' && item.outcome !== 'uncertain') continue;
    const result = adapter.lookup(key, item.digest);
    if (result?.status === 'committed' && typeof result.receipt === 'string') {
      if (item.outcome === 'uncertain') workflow.resolve(key, result.receipt);
      else workflow.acknowledge(key, result.receipt);
    } else if (item.outcome === 'pending') {
      workflow.unknown(key);
    }
  }
  return workflow.get_state();
}
