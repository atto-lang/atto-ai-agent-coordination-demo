import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { receiptFromOutput, verifyNativeCheck, verifyNativeGuest } from '../scripts/native-evidence.mjs';

const SHA = 'a'.repeat(40);
const digest = content => createHash('sha256').update(content).digest('hex');
const sourceDirs = [['src', 8], ['src/memory', 9], ['src/runtime', 3], ['tests/guest', 1]];

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
  manifest.sort();
  writeFileSync(join(dir,'tests/guest/agent_pipeline.ores'), 'fnc main():void {}');
  manifest.push('tests/guest/agent_pipeline.ores');
  manifest.sort();
  writeFileSync(join(dir,'tests/guest/agent_pipeline.stdout'),'passed');
  const outcomes = manifest.map(file => ({
    file, source_sha256:digest(readFileSync(join(dir,file))),
    passed:true, exit_code:0, signal:null
  }));
  const check={compiler_source_head:SHA,checked:manifest.length,
    required:manifest.length,passed:true,manifest,outcomes};
  const guest={test:'agent_pipeline',compiler_source_head:SHA,
    compiler_worktree_clean:true,passed:true,executed:true,
    exit_code:0,signal:null,stdout_exact:true,
    fixture_sha256:digest(readFileSync(join(dir,'tests/guest/agent_pipeline.ores'))),
    oracle_sha256:digest(readFileSync(join(dir,'tests/guest/agent_pipeline.stdout')))};
  return {dir,check,guest,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
const clone=x=>structuredClone(x);

test('accepts exact source hashes, complete compiler outcomes and guest receipt',()=>{
  const s=sample();
  try {
    const out=verifyNativeCheck(s.check,s.dir,SHA);
    assert.equal(out.checked_actors,20);
    assert.equal(out.checked_guest_sources,2);
    assert.equal(verifyNativeGuest(s.guest,s.dir,SHA).guest_scenarios,1);
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
      x=>{x.compiler_source_head='b'.repeat(40);}
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
      x=>{x.executed=false;},x=>{x.stdout_exact=false;},
      x=>{x.exit_code=1;},x=>{x.compiler_source_head='b'.repeat(40);},
      x=>{x.passed=false;},x=>{x.oracle_sha256='b'.repeat(64);}
    ]){
      const bad=clone(s.guest);mutation(bad);
      assert.throws(()=>verifyNativeGuest(bad,s.dir,SHA));
    }
  } finally{s.cleanup()}
});
