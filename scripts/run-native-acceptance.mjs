#!/usr/bin/env node
// Strict native acceptance: actor grammar + typed-negative check + 3 guest
// behaviors. A zero exit alone is NOT evidence of any Oreslang guest run.
// This does not prove distributed durability, authentication or backend parity.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = ['check-native-actors.mjs', 'run-native-guest.mjs', 'run-step-native-guest.mjs'];
const demo = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const expected = process.env.ORESLANG_DEMO_SHA ?? '';
const compiler = process.env.ORESLANG_COMPILER_SHA ?? '';
const sha256 = path => createHash('sha256').update(readFileSync(join(demo,path))).digest('hex');
const guests = ['agent_pipeline','direct_agent_hop','step_agent_flow'];
const guestPaths = guests.map(name => 'tests/guest/' + name + '.ores');
const actorDirs = [['src',8],['src/memory',9],['src/runtime',4]];
function fail(message) {
  console.error('NATIVE_ACCEPTANCE_UNVERIFIED ' + message);
  process.exit(2);
}
if (!/^[a-f0-9]{40}$/.test(expected)) fail('exact ORESLANG_DEMO_SHA required');
if (!/^[a-f0-9]{40}$/.test(compiler)) fail('exact ORESLANG_COMPILER_SHA required');
let head, tree, dirty;
try {
  const opt = { encoding:'utf8', timeout:10000, maxBuffer:1024*1024 };
  head = execFileSync('git',['-C',demo,'rev-parse','HEAD'],opt).trim();
  tree = execFileSync('git',['-C',demo,'rev-parse','HEAD^{tree}'],opt).trim();
  dirty = execFileSync('git',['-C',demo,'status','--porcelain','--untracked-files=no'],opt).trim();
} catch { fail('demo Git checkout unavailable'); }
if (head !== expected || dirty) fail('demo revision mismatch or dirty tracked source');
function sourceManifest() {
  let actorPaths=[];
  for(const [directory,minimum] of actorDirs) {
    const names=readdirSync(join(demo,directory),{withFileTypes:true})
      .filter(entry=>entry.name.endsWith('.ores'));
    if(names.length < minimum || names.some(e=>!e.isFile()))
      fail('actor manifest incomplete or not regular files');
    actorPaths.push(...names.map(e=>directory+'/'+e.name));
  }
  const paths=[...actorPaths,...guestPaths].sort();
  if(new Set(paths).size!==paths.length) fail('duplicate native source inventory');
  return {actorPaths,paths};
}
const {actorPaths,paths}=sourceManifest();
function readMarker(output, marker) {
  const matches = output.split('\n').filter(line=>line.startsWith(marker));
  if(matches.length!==1) fail('missing or ambiguous evidence marker '+marker);
  try { return JSON.parse(matches[0].slice(marker.length)); }
  catch { fail('malformed structured evidence '+marker); }
}
function requireEvidence(script, output) {
  const marker = script==='check-native-actors.mjs' ? 'NATIVE_CHECK_RESULT ' :
    script==='run-step-native-guest.mjs' ? 'STEP_NATIVE_GUEST_RESULT ' : 'NATIVE_GUEST_RESULT ';
  const record=readMarker(output,marker);
  if(record?.passed!==true || record.compiler_source_head!==compiler)
    fail('failed result or wrong compiler identity: '+script);
  if(script==='check-native-actors.mjs') {
    if(record.checked!==paths.length || record.required!==paths.length ||
       record.actor_count!==actorPaths.length ||
       !Array.isArray(record.manifest) || !Array.isArray(record.outcomes) ||
       record.manifest.length!==paths.length || record.outcomes.length!==paths.length)
      fail('incomplete native source coverage');
    for(let i=0;i<paths.length;i++) {
      const out=record.outcomes[i];
      if(record.manifest[i]!==paths[i] || out?.file!==paths[i] ||
         out.passed!==true || out.exit_code!==0 || out.signal ||
         out.source_sha256!==sha256(paths[i]))
        fail('incorrect compiler source receipt: '+paths[i]);
    }
    const negative='tests/guest/negative/wrong_actor_mail_type.ores', n=record.negative;
    if(n?.file!==negative || n.passed!==true || n.signal ||
       !Number.isInteger(n.exit_code) || n.exit_code===0 ||
       n.source_sha256!==sha256(negative) ||
       n.expected_type_error!=='ActorRef.send mailbox value' ||
       !String(n.diagnostic||'').includes('ActorRef.send mailbox value'))
      fail('unverified negative mailbox typing receipt');
  } else {
    const required = script==='run-step-native-guest.mjs' ?
      ['step_agent_flow'] : ['agent_pipeline','direct_agent_hop'];
    if(record.cases_required!==required.length || record.cases_executed!==required.length ||
       !Array.isArray(record.results) || record.results.length!==required.length)
      fail('incomplete executable guest receipt: '+script);
    for(let i=0;i<required.length;i++) {
      const name=required[i], r=record.results[i];
      if(r?.name!==name || r.passed!==true || r.stdout_exact!==true ||
         r.exit_code!==0 || r.signal || r.error ||
         r.source_sha256!==sha256('tests/guest/'+name+'.ores') ||
         r.oracle_sha256!==sha256('tests/guest/'+name+'.stdout'))
        fail('guest identity, output or exit mismatch: '+name);
    }
  }
  return record;
}
const evidence=[];
for (const script of scripts) {
  const file=fileURLToPath(new URL(script,import.meta.url));
  const result=spawnSync(process.execPath,[file],{
    env:process.env,encoding:'utf8',timeout:360000,maxBuffer:3*1024*1024,shell:false
  });
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.error || result.signal || result.status!==0)
    fail('failed or unexecuted gate: '+script);
  evidence.push(requireEvidence(script,result.stdout || ''));
}
console.log('NATIVE_ACCEPTANCE_RESULT '+JSON.stringify({
  demo_head:head,demo_tree:tree,compiler_source_head:compiler,
  checked_actors:actorPaths.length,positive_native_checks:paths.length,
  negative_native_checks:1,guest_scenarios:3,
  source_digests:paths.map(path=>({path,sha256:sha256(path)})),
  passed:true,
  scope:'Java compiler checks, negative mailbox test, 3 byte-exact Oreslang guests; no durability'
}));
