// Host-native C ABI and Oreslang contract evidence checks only.
// The actual compiled C++ executable is run separately by check-native-sqlite.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const get = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
const header=get('native/workflow_sqlite.h');
const source=get('native/workflow_sqlite.cpp');
const contract=get('contracts/native/workflow_storage.ores');
const build=get('scripts/check-native-sqlite.sh');
const compiler=get('scripts/check-native-actors.mjs');
const acceptance=get('scripts/run-native-acceptance.mjs');

test('native C ABI exposes exactly scoped durable storage primitives',()=>{
  for(const name of ['wf_open','wf_close','wf_create_run','wf_activate',
    'wf_accept_step','wf_claim_dispatch','wf_reconcile','wf_finish','wf_inspect'])
    assert.match(header,new RegExp('\\b'+name+'\\('));
  assert.match(header,/wf_authorize_fn/);
  assert.match(header,/wf_verify_receipt_fn/);
  assert.match(header,/const char \*message_id/);
  assert.match(header,/const char \*outcome, const char \*receipt/);
});

test('storage uses SQLite WAL+FULL, bounded CAS and one-shot dispatch claim',()=>{
  assert.match(source,/PRAGMA journal_mode=WAL/);
  assert.match(source,/PRAGMA synchronous=FULL/);
  assert.match(source,/BEGIN IMMEDIATE/);
  assert.match(source,/O_NOFOLLOW/);
  assert.match(source,/std::mutex mutex/);
  assert.match(source,/std::lock_guard<std::mutex> lock/);
  assert.match(source,/epoch=epoch\+1,version=version\+1/);
  assert.match(source,/state='prepared'/);
  assert.match(source,/state='in_doubt'/);
  assert.match(source,/state='committed'/);
  assert.match(source,/state='finished'/);
});

test('receipt checking is performed outside SQLite writer lock then CAS checked again',()=>{
  const reconcile=source.slice(source.indexOf('int wf_reconcile('),source.indexOf('int wf_finish('));
  assert.match(reconcile,/s->verify\(s->context/);
  assert.ok(reconcile.indexOf('s->verify(s->context') <
    reconcile.indexOf('Tx tx(s);'), 'remote verification must precede write transaction');
  assert.match(reconcile,/fenced\(s,t,r,rev,epoch,version\)/);
  assert.match(reconcile,/effect_key=\? AND digest=\? AND state='in_doubt'/);
  assert.match(reconcile,/UPDATE inbox SET state=\?/);
});

test('Oreslang port remains a pure contract with no pretend SQLite FFI implementation',()=>{
  assert.match(contract,/define contract WorkflowDurableStorage as/);
  for(const method of ['create_run','activate','accept_step','claim_dispatch','reconcile','finish'])
    assert.match(contract,new RegExp('fnc '+method+'\\('));
  assert.doesNotMatch(contract,/\b(?:spawn|await|foreign-source|sqlite3_open|nodejs)\b/);
  assert.match(compiler,/contracts\/native\/workflow_storage\.ores/);
  assert.match(acceptance,/contracts\/native\/workflow_storage\.ores/);
});

test('native test runner has real compilation, timeout and fail-closed dependency checks',()=>{
  assert.match(build,/set -euo pipefail/);
  assert.match(build,/g\+\+ -std=c\+\+17/);
  assert.match(build,/-Wall -Wextra -Werror/);
  assert.match(build,/pkg-config --exists sqlite3/);
  assert.match(build,/tests\/native_sqlite_test\.cpp/);
  const syntax=spawnSync('bash',['-n',new URL('../scripts/check-native-sqlite.sh',import.meta.url).pathname],
    {encoding:'utf8',timeout:3000});
  assert.equal(syntax.status,0,syntax.stderr);
});
