// Experimental Node 22 SQLite durability reference, NOT an Oreslang runtime.
// Storage-enforced local CAS and durable intents; no distributed consensus,
// cryptographic approvals, remote tool provider or multi-machine lease.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';

function require_that(ok, reason) { if (!ok) throw Error(reason); }
const valid_id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(v);
const valid_sha = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const valid_digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const valid_receipt = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v);

export class SqliteWorkflowSupervisor {
  #db;
  constructor(directory) {
    const root = resolve(directory);
    mkdirSync(root, { recursive:true, mode:0o700 });
    const stat = lstatSync(root);
    require_that(stat.isDirectory() && (stat.mode & 0o077) === 0,
      'private, nonsymlink storage directory required');
    const path = join(root, 'workflow-supervisor.sqlite');
    this.#db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS workflow (
        tenant TEXT NOT NULL, run TEXT NOT NULL, revision TEXT NOT NULL,
        epoch INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
        phase TEXT NOT NULL DEFAULT 'running',
        PRIMARY KEY(tenant, run)
      );
      CREATE TABLE IF NOT EXISTS effects (
        tenant TEXT NOT NULL, run TEXT NOT NULL, step TEXT NOT NULL,
        effect_key TEXT NOT NULL UNIQUE, digest TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'in_doubt', receipt TEXT UNIQUE,
        PRIMARY KEY(tenant, run, step),
        FOREIGN KEY(tenant, run) REFERENCES workflow(tenant, run)
      );
    `);
  }
  close() { this.#db.close(); }
  #transaction(callback) {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const value = callback(); this.#db.exec('COMMIT'); return value; }
    catch (err) { this.#db.exec('ROLLBACK'); throw err; }
  }
  create_run(tenant, run, revision) {
    require_that(valid_id(tenant) && valid_id(run) && valid_sha(revision), 'invalid run identity');
    return this.#transaction(() => {
      this.#db.prepare('INSERT INTO workflow(tenant,run,revision) VALUES (?,?,?)').run(tenant,run,revision);
      return {tenant,run,revision,epoch:0,version:0};
    });
  }
  activate(tenant, run, revision) {
    require_that(valid_id(tenant) && valid_id(run) && valid_sha(revision), 'invalid activation identity');
    return this.#transaction(() => {
      const row=this.#db.prepare('SELECT * FROM workflow WHERE tenant=? AND run=?').get(tenant,run);
      require_that(row && row.revision===revision && row.epoch < 2147483646,
        'missing run, stale revision or epoch overflow');
      this.#db.prepare('UPDATE workflow SET epoch=epoch+1,version=version+1 WHERE tenant=? AND run=?')
        .run(tenant,run);
      return {epoch:row.epoch+1,version:row.version+1};
    });
  }
  #fenced(tenant, run, revision, epoch, expected_version) {
    require_that(valid_id(tenant) && valid_id(run) && valid_sha(revision) &&
      Number.isSafeInteger(epoch) && Number.isSafeInteger(expected_version), 'bad fence');
    const row=this.#db.prepare('SELECT * FROM workflow WHERE tenant=? AND run=?').get(tenant,run);
    require_that(row && row.revision===revision && row.epoch===epoch &&
      row.version===expected_version && row.phase==='running' && row.version<2147483646,
      'stale generation, revision, version or terminal run');
    return row;
  }
  prepare_effect({tenant,run,revision,epoch,version,step,key,digest}) {
    require_that(valid_id(step) && valid_id(key) && valid_digest(digest), 'invalid effect identity');
    return this.#transaction(() => {
      this.#fenced(tenant,run,revision,epoch,version);
      // Durable prepare happens BEFORE caller dispatch. A crash immediately
      // after this transaction is ambiguous: never resend without lookup.
      this.#db.prepare('INSERT INTO effects(tenant,run,step,effect_key,digest) VALUES(?,?,?,?,?)')
        .run(tenant,run,step,key,digest);
      this.#db.prepare('UPDATE workflow SET version=version+1 WHERE tenant=? AND run=?').run(tenant,run);
      return {epoch,version:version+1,state:'in_doubt'};
    });
  }
  // The caller MUST inject a trusted local adapter that verifies the durable
  // remote result by exact idempotency key+digest; strings are NOT signatures.
  reconcile({tenant,run,revision,epoch,version,step,decision,receipt}, adapter) {
    require_that(valid_id(step) && valid_receipt(receipt) &&
      (decision==='committed' || decision==='not_applied'), 'invalid reconciliation');
    require_that(adapter && typeof adapter.verify_receipt==='function',
      'trusted verification adapter required');
    return this.#transaction(() => {
      this.#fenced(tenant,run,revision,epoch,version);
      const effect=this.#db.prepare('SELECT * FROM effects WHERE tenant=? AND run=? AND step=?')
        .get(tenant,run,step);
      require_that(effect && effect.state==='in_doubt', 'effect not in doubt');
      const verified=adapter.verify_receipt({tenant,run,step,key:effect.effect_key,
        digest:effect.digest,decision,receipt});
      require_that(verified===true, 'unverified remote receipt');
      this.#db.prepare('UPDATE effects SET state=?, receipt=? WHERE tenant=? AND run=? AND step=?')
        .run(decision,receipt,tenant,run,step);
      this.#db.prepare('UPDATE workflow SET version=version+1 WHERE tenant=? AND run=?')
        .run(tenant,run);
      return {epoch,version:version+1,state:decision};
    });
  }
  finish({tenant,run,revision,epoch,version}) {
    return this.#transaction(() => {
      this.#fenced(tenant,run,revision,epoch,version);
      const summary=this.#db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN state='committed' THEN 1 ELSE 0 END) AS committed
        FROM effects WHERE tenant=? AND run=?`).get(tenant,run);
      require_that(summary.total>0 && summary.total===summary.committed, 'unfinished or uncertain effects');
      this.#db.prepare("UPDATE workflow SET phase='finished',version=version+1 WHERE tenant=? AND run=?")
        .run(tenant,run);
      return {epoch,version:version+1,phase:'finished'};
    });
  }
  inspect(tenant, run) {
    require_that(valid_id(tenant) && valid_id(run), 'invalid read identity');
    const workflow=this.#db.prepare('SELECT * FROM workflow WHERE tenant=? AND run=?').get(tenant,run);
    if (!workflow) return null;
    const effects=this.#db.prepare('SELECT step,effect_key,digest,state,receipt FROM effects WHERE tenant=? AND run=? ORDER BY step')
      .all(tenant,run);
    return {workflow:{...workflow},effects:effects.map(x=>({...x}))};
  }
}
