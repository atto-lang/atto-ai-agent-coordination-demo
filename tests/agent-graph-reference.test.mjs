// Pure-JavaScript executable SPECIFICATION ORACLE, not an Oreslang runtime test.
// Pin observable decision-DAG/cache behavior until native guest execution exists.
import assert from 'node:assert/strict';
import { test } from 'node:test';

class DecisionDagModel {
  branches = new Map();
  terminals = new Set();
  revision = 0;
  add_terminal(id) {
    if (!id || this.branches.size + this.terminals.size >= 256 ||
        this.terminals.has(id) || this.branches.has(id)) return false;
    this.terminals.add(id);
    this.revision++;
    return true;
  }
  add_branch(id, yes, no) {
    const known = (v) => this.terminals.has(v) || this.branches.has(v);
    if (!id || !yes || !no || this.branches.size + this.terminals.size >= 256 ||
        known(id) || !known(yes) || !known(no)) return false;
    this.branches.set(id, [yes, no]);
    this.revision++;
    return true;
  }
  next(id, predicate, expected_revision) {
    if (expected_revision !== this.revision) throw Error('decision graph changed');
    const targets = this.branches.get(id);
    if (!targets) throw Error('not a branch');
    return targets[predicate ? 0 : 1];
  }
  is_terminal(id, expected_revision) {
    if (expected_revision !== this.revision) throw Error('decision graph changed');
    if (this.terminals.has(id)) return true;
    if (this.branches.has(id)) return false;
    throw Error('unknown decision node');
  }
}

class RevisionCacheModel {
  graph_id = '';
  revision = -1;
  slots = [];
  activate(id, revision) {
    if (!id || revision < 0 || (this.graph_id && id !== this.graph_id) ||
        revision <= this.revision) return false;
    this.graph_id = id;
    this.revision = revision;
    this.slots = [];
    return true;
  }
  put(id, revision, key, payload, expiry, now) {
    if (id !== this.graph_id || revision !== this.revision || !key || expiry <= now)
      return false;
    let reusable = -1;
    for (let i = 0; i < this.slots.length; ++i) {
      const item = this.slots[i];
      if (item.key === key) {
        if (now < item.expiry) return false;
        reusable = i;
      } else if (now >= item.expiry && reusable < 0) {
        reusable = i;
      }
    }
    const entry = { key, payload, expiry };
    if (reusable >= 0) this.slots[reusable] = entry;
    else if (this.slots.length < 1024) this.slots.push(entry);
    else return false;
    return true;
  }
  get(id, revision, key, now) {
    if (id !== this.graph_id || revision !== this.revision) throw Error('cache revision mismatch');
    const entry = this.slots.find((item) => item.key === key);
    if (!entry) throw Error('cache miss');
    if (now >= entry.expiry) throw Error('expired');
    return entry.payload;
  }
}

test('DAG requires leaves before branches and rejects unknown/self/cyclic targets', () => {
  const dag = new DecisionDagModel();
  assert.equal(dag.add_branch('root', 'pass', 'fail'), false);
  assert.equal(dag.add_terminal('pass'), true);
  assert.equal(dag.add_terminal('fail'), true);
  assert.equal(dag.add_branch('root', 'pass', 'fail'), true);
  assert.equal(dag.add_branch('bad', 'root', 'missing'), false);
  assert.equal(dag.add_branch('cycle', 'cycle', 'pass'), false);
  assert.equal(dag.add_branch('pass', 'root', 'fail'), false);
  assert.equal(dag.add_branch('higher', 'root', 'fail'), true);
  assert.equal(dag.next('higher', true, dag.revision), 'root');
  assert.equal(dag.is_terminal('pass', dag.revision), true);
  assert.equal(dag.is_terminal('root', dag.revision), false);
});

test('DAG refuses old revision after mutation and unknown terminal IDs', () => {
  const dag = new DecisionDagModel();
  dag.add_terminal('ok');
  dag.add_terminal('no');
  dag.add_branch('root', 'ok', 'no');
  const before = dag.revision;
  assert.equal(dag.next('root', false, before), 'no');
  dag.add_terminal('more');
  assert.throws(() => dag.next('root', true, before), /changed/);
  assert.throws(() => dag.is_terminal('unknown', dag.revision), /unknown/);
});

test('DAG has a strict 256-node budget and unique namespaces', () => {
  const dag = new DecisionDagModel();
  for (let i = 0; i < 256; i++) assert.equal(dag.add_terminal('leaf-' + i), true);
  assert.equal(dag.add_terminal('extra'), false);
  assert.equal(dag.add_terminal('leaf-0'), false);
  assert.equal(dag.add_branch('root', 'leaf-0', 'leaf-1'), false);
});

test('cache prohibits rebind and rollback, invalidating on revision advance', () => {
  const c = new RevisionCacheModel();
  assert.equal(c.activate('graph-A', 2), true);
  assert.equal(c.put('graph-A', 2, 'x', 'old', 20, 10), true);
  assert.equal(c.activate('graph-B', 99), false);
  assert.equal(c.activate('graph-A', 1), false);
  assert.equal(c.activate('graph-A', 2), false);
  assert.equal(c.activate('graph-A', 3), true);
  assert.throws(() => c.get('graph-A', 2, 'x', 11), /revision/);
  assert.throws(() => c.get('graph-A', 3, 'x', 11), /miss/);
});

test('cache returns hit only before expiry and never overwrites live values', () => {
  const c = new RevisionCacheModel();
  c.activate('graph', 0);
  assert.equal(c.put('graph', 0, 'k', 'v', 8, 2), true);
  assert.equal(c.put('graph', 0, 'k', 'changed', 9, 3), false);
  assert.equal(c.get('graph', 0, 'k', 7), 'v');
  assert.throws(() => c.get('graph', 0, 'k', 8), /expired/);
  assert.equal(c.put('graph', 0, 'k', 'new', 19, 8), true);
  assert.equal(c.get('graph', 0, 'k', 8), 'new');
  assert.equal(c.slots.length, 1);
});

test('cache recycles expired slots at capacity without exceeding its budget', () => {
  const c = new RevisionCacheModel();
  c.activate('graph', 0);
  for (let i = 0; i < 1024; i++) assert.equal(c.put('graph', 0, 'k' + i, 'v', 5, 1), true);
  assert.equal(c.put('graph', 0, 'fresh', 'x', 8, 2), false);
  assert.equal(c.put('graph', 0, 'fresh', 'x', 10, 5), true);
  assert.equal(c.get('graph', 0, 'fresh', 5), 'x');
  assert.equal(c.slots.length, 1024);
});
