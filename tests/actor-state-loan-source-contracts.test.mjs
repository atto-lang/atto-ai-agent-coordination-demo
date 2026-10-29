// Source-only structural contract, NOT proof of compiler admission or actor execution.
// Persistent actor instance fields must live in one sealed state schema.
// Mutable access is confined to handle_state(critical write |s| -> {...}).
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const root=new URL('../src/',import.meta.url);
function sources(dir=root,prefix='src/') {
  const out=[];
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const child=new URL(entry.name+(entry.isDirectory()?'/':''),dir);
    if(entry.isDirectory())out.push(...sources(child,prefix+entry.name+'/'));
    else if(entry.name.endsWith('.ores'))out.push([prefix+entry.name,readFileSync(child,'utf8')]);
  }
  return out;
}
const files=sources();

test('all stateful actors use one sealed state schema and no ordinary instance fields',()=>{
  assert.equal(files.length,20,'update this census when adding an actor');
  for(const [path,src] of files) {
    assert.match(src,/^define isolated actor [A-Za-z][A-Za-z0-9_]* as/m,path);
    assert.equal((src.match(/^  state\s*\{/gm)||[]).length,1,path);
    assert.doesNotMatch(src,/^  (?:let|val|var|mut)\s/m,path);
    assert.doesNotMatch(src,/\bself\.state\b/,path);
    assert.doesNotMatch(src,/\bpub\s+fnc\b/,path);
    assert.match(src,/self\.handle_state\(/,path);
    assert.match(src,/with state\.read/,path);
  }
});

test('critical write loans are explicit, and actor-local state cannot be read through self fields',()=>{
  for(const [path,src] of files) {
    const schema=/^  state\s*\{([\s\S]*?)^  \}/m.exec(src);
    assert.ok(schema,path);
    const fields=[...schema[1].matchAll(/^    ([a-z][a-z0-9_]*):\s*[^\n;]+;/gm)].map(m=>m[1]);
    assert.ok(fields.length>0,path);
    for(const field of fields) {
      assert.doesNotMatch(src,new RegExp('\\bself\\.'+field+'\\b'),path+' unsafe direct field access');
      assert.match(src,new RegExp('\\bs\\.'+field+'\\b'),path+' missing scoped access');
    }
    // Source-level check only. The compiler must additionally establish effect
    // bounds, handle_state sealing and that no loan escapes or crosses await.
    if(src.includes('state.write')) {
      assert.match(src,/self\.handle_state\(critical write \|s\| -> \{/,path);
      assert.match(src,/with state\.read, state\.write/,path);
    }
  }
});

test('no nested state loan calls inside mutable graph transactions',()=>{
  for(const path of ['src/knowledge_graph.ores','src/runtime/execution_graph.ores']) {
    const src=files.find(([p])=>p===path)?.[1];
    assert.ok(src,path);
    assert.doesNotMatch(src,/self\.(?:contains|prerequisites_done)\(/,path);
  }
});
