import {test} from 'node:test';
import assert from 'node:assert/strict';
import {create_agent_gateway} from '../reference/agent-gateway.mjs';
const sha='a'.repeat(40);
const token='local-fixture-secret-32-bytes-minimum-00';
const graph={revision:sha,entities:{'repo:ores':{id:'repo:ores',label:'Oreslang'}},edges:{'repo:ores':['module:actors']}};
const decision={next:(node,truth)=>{if(node!=='review') throw Error('unknown node');return truth?'approved':'research';}};
const workflow={id:'w1',status:'planned',revision:sha};
const request = (operation,args={},extras={})=>({schema_version:1,request_id:'req-01',tenant_id:'demo',actor_id:'repo-graph',expected_revision:sha,operation,args,...extras});
async function on_server(action){
 const server=create_agent_gateway({token,graph,decision,workflow});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {return await action(`http://127.0.0.1:${server.address().port}/v1/request`);}
 finally {await new Promise(resolve=>server.close(resolve));}
}
async function post(url,body,auth=token){
 const resp=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)});
 return {status:resp.status,json:await resp.json()};
}
test('cross-language JSON envelope provides version-pinned entity lookup',()=>on_server(async url=>{
 const r=await post(url,request('knowledge.get_entity',{id:'repo:ores'}));
 assert.equal(r.status,200);assert.equal(r.json.value.label,'Oreslang');
}));
test('neighbor lookup and decision routes are bounded read-only',()=>on_server(async url=>{
 assert.deepEqual((await post(url,request('knowledge.neighbors',{id:'repo:ores'}))).json.value,['module:actors']);
 assert.equal((await post(url,request('decision.next',{node_id:'review',predicate:true}))).json.value,'approved');
 assert.equal((await post(url,request('workflow.status',{id:'w1'}))).json.value.status,'planned');
}));
test('denies missing auth and stale revision',()=>on_server(async url=>{
 assert.equal((await post(url,request('workflow.status',{id:'w1'}),null)).status,401);
 assert.equal((await post(url,request('workflow.status',{id:'w1'}), 'wrong')).status,401);
 assert.equal((await post(url,request('workflow.status',{id:'w1'},{expected_revision:'b'.repeat(40)}))).status,409);
}));
test('denies effect execution, tenant isolation violations and invalid input',()=>on_server(async url=>{
 assert.equal((await post(url,request('tool.execute',{cmd:'rm -rf /'}))).status,400);
 assert.equal((await post(url,request('knowledge.get_entity',{id:'x'},{tenant_id:'other'}))).status,403);
 assert.equal((await post(url,request('knowledge.get_entity',{id:'a'.repeat(256)}))).status,422);
 assert.equal((await post(url,request('knowledge.get_entity',{id:'__proto__'}))).json.value,null);
}));

test('rejects unknown envelope keys, extra operation arguments and bad revisions',()=>on_server(async url=>{
 assert.equal((await post(url,request('workflow.status',{id:'w1'},{surprise:'smuggled'}))).status,400);
 assert.equal((await post(url,request('knowledge.get_entity',{id:'repo:ores',tool:'write'}))).status,422);
 assert.equal((await post(url,request('workflow.status',{id:'w1'},{expected_revision:'not-a-sha'}))).status,400);
 assert.equal((await post(url,request('workflow.status',null))).status,422);
}));
test('rejects unsupported content type and compressed content',()=>on_server(async url=>{
 const invalid=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,
   'content-type':'text/plain'},body:JSON.stringify(request('workflow.status',{id:'w1'}))});
 assert.equal(invalid.status,415);
 const compressed=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,
   'content-type':'application/json','content-encoding':'gzip'},
   body:JSON.stringify(request('workflow.status',{id:'w1'}))});
 assert.equal(compressed.status,415);
}));
test('rejects oversized trusted graph output before disclosing value',async()=>{
 const server=create_agent_gateway({token,graph:{revision:sha,
   entities:{big:{id:'big',body:'x'.repeat(20000)}},edges:{}},decision,workflow});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
   const url=`http://127.0.0.1:${server.address().port}/v1/request`;
   const r=await post(url,request('knowledge.get_entity',{id:'big'}));
   assert.equal(r.status,413);
   assert.equal(r.json.error,'response too large');
   assert.equal(JSON.stringify(r.json).includes('xxxxxxxxxxxxxxxx'),false);
 } finally {await new Promise(resolve=>server.close(resolve));}
});
test('hides internal decision engine errors from network callers',async()=>{
 const server=create_agent_gateway({token,graph,workflow,
   decision:{next:()=>{throw Error('internal-credential-should-not-leak');}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
   const url=`http://127.0.0.1:${server.address().port}/v1/request`;
   const r=await post(url,request('decision.next',{node_id:'review',predicate:true}));
   assert.equal(r.status,422);
   assert.equal(JSON.stringify(r.json).includes('internal-credential'),false);
 } finally {await new Promise(resolve=>server.close(resolve));}
});
