import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { receiptFromOutput, verifyNativeCheck, verifyNativeGuest } from '../scripts/native-evidence.mjs';

const SHA = 'a'.repeat(40);
const digest = content => createHash('sha256').update(content).digest('hex');
const sourceDirs = [['src', 8], ['src/memory', 9], ['src/runtime', 3]];

function sample() {
  const dir = mkdtempSync(join(tmpdir(), 'ores-evidence-'));
  const manifest = [];
  for (const [subdir, count] of sourceDirs) {
    mkdirSync(join(dir, subdir), {recursive:true});
    for (let i=0; i<count; i++) {
      const file=subdir+'/fixture'+i+'.ores';
      writeFileSync(join(dir,file), 'fnc sample'+i+'(): void { return; }\n');
      manifest.push(file);
    }
  }
  mkdirSync(join(dir,'tests/guest'),{recursive:true});
  for (const name of ['agent_pipeline', 'direct_agent_hop']) {
    writeFileSync(join(dir,'tests/guest/'+name+'.ores'), 'fnc main():void {}');
    manifest.push('tests/guest/'+name+'.ores');
    writeFileSync(join(dir,'tests/guest/'+name+'.stdout'),'passed');
  }
  manifest.sort();
  mkdirSync(join(dir,'tests/guest/negative'),{recursive:true});
  const negPath=join(dir,'tests/guest/negative/wrong_actor_mail_type.ores');
  writeFileSync(negPath, 'fnc main():void { error(); }');
  const outcomes = manifest.map(file => ({
    file, source_sha256:digest(readFileSync(join(dir,file))),
    passed:true, exit_code:0, signal:null
  }));
  const check={compiler_source_head:SHA,checked:manifest.length,
    required:manifest.length,actor_count:20,passed:true,manifest,outcomes,
    negative:{file:'tests/guest/negative/wrong_actor_mail_type.ores',
      source_sha256:digest(readFileSync(negPath)),exit_code:1,signal:null,
      expected_type_error:'ActorRef.send mailbox value',
      passed:true,diagnostic:'ActorRef.send mailbox value'}};
  const guest={compiler_source_head:SHA,cases_required:2,cases_executed:2,
    passed:true,results:['agent_pipeline','direct_agent_hop'].map(name=>({
      name,passed:true,exit_code:0,signal:null,error:null,stdout_exact:true,
      source_sha256:digest(readFileSync(join(dir,'tests/guest/'+name+'.ores'))),
      oracle_sha256:digest(readFileSync(join(dir,'tests/guest/'+name+'.stdout')))
    }))};
  return {dir,check,guest,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
const clone=x=>structuredClone(x);

test('accepts exact source hashes, complete compiler outcomes and guest receipt',()=>{
  const s=sample();
  try {
    const out=verifyNativeCheck(s.check,s.dir,SHA);
    assert.equal(out.checked_actors,20);
    assert.equal(out.checked_guest_sources,2);
    assert.equal(verifyNativeGuest(s.guest,s.dir,SHA).guest_scenarios,2);
  } finally {s.cleanup()}
});
test('rejects missing duplicate and forged native receipt lines',()=>{
  assert.throws(()=>receiptFromOutput('', 'NATIVE_CHECK_RESULT'), /missing/);
  assert.throws(()=>receiptFromOutput('NATIVE_CHECK_RESULT {}\nNATIVE_CHECK_RESULT {}',
    'NATIVE_CHECK_RESULT'),/duplicate/);
  assert.throws(()=>receiptFromOutput('NATIVE_CHECK_RESULT broken',
    'NATIVE_CHECK_RESULT'),/malformed/);
});
test('rejects failed, missing, or altered compiler outcomes',()=>{
  const s=sample();
  try{
    for(const mutation of [
      x=>{x.outcomes[0].passed=false;},
      x=>{x.outcomes[0].exit_code=1;},
      x=>{x.outcomes[0].signal='SIGTERM';},
      x=>{x.outcomes.pop();},
      x=>{x.manifest.reverse();},
      x=>{x.outcomes[0].source_sha256='b'.repeat(64);},
      x=>{x.compiler_source_head='b'.repeat(40);},
      x=>{x.negative.passed=false;},
      x=>{x.negative.diagnostic='syntax error';},
      x=>{x.negative.exit_code=0;}
    ]){
      const bad=clone(s.check);mutation(bad);
      assert.throws(()=>verifyNativeCheck(bad,s.dir,SHA));
    }
    writeFileSync(join(s.dir,s.check.manifest[0]),'tampered');
    assert.throws(()=>verifyNativeCheck(s.check,s.dir,SHA),/hash mismatch/);
  } finally{s.cleanup()}
});
test('rejects guest reports without actual exact execution',()=>{
  const s=sample();
  try{
    for(const mutation of [
      x=>{x.results[0].passed=false;},x=>{x.results[1].stdout_exact=false;},
      x=>{x.results[0].exit_code=1;},x=>{x.compiler_source_head='b'.repeat(40);},
      x=>{x.passed=false;},x=>{x.results[1].oracle_sha256='b'.repeat(64);},
      x=>{x.results.pop();},x=>{x.results[0].name='wrong_case';}
    ]){
      const bad=clone(s.guest);mutation(bad);
      assert.throws(()=>verifyNativeGuest(bad,s.dir,SHA));
    }
  } finally{s.cleanup()}
});


test('rejects unlisted nested actor source instead of silently omitting it', () => {
  const s = sample();
  try {
    mkdirSync(join(s.dir, 'src/extra'), {recursive:true});
    writeFileSync(join(s.dir, 'src/extra/unsafe.ores'), 'define isolated actor Unsafe as end\n');
    assert.throws(() => verifyNativeCheck(s.check, s.dir, SHA),
      /unlisted native actor source/);
  } finally { s.cleanup(); }
});
test('rejects symlinked actor source even when pointing inside checkout', () => {
  const s = sample();
  try {
    symlinkSync(join(s.dir, 'src/fixture0.ores'), join(s.dir, 'src/linked.ores'));
    assert.throws(() => verifyNativeCheck(s.check, s.dir, SHA),
      /(?:symlink in actor source tree|nonregular)/);
  } finally { s.cleanup(); }
});
