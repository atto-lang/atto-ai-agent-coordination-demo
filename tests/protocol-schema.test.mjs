import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const request=JSON.parse(readFileSync(new URL('../contracts/v1/agent-request.schema.json',import.meta.url)));
const response=JSON.parse(readFileSync(new URL('../contracts/v1/agent-response.schema.json',import.meta.url)));
test('read-only interoperability contract is versioned and closed',()=>{
 assert.equal(request.$schema,'https://json-schema.org/draft/2020-12/schema');
 assert.equal(request.additionalProperties,false);
 assert.equal(request.properties.schema_version.const,1);
 assert.deepEqual(request.properties.operation.enum,['knowledge.get_entity','knowledge.neighbors','decision.next','workflow.status']);
 assert.equal(request.properties.operation.enum.includes('tool.execute'),false);
 assert.equal(request.required.includes('expected_revision'),true);
});
test('response contract separates value from error',()=>{
 assert.equal(response.additionalProperties,false);
 assert.equal(response.oneOf.length,2);
 assert.equal(response.properties.schema_version.const,1);
});

test('schema pins Git SHA and denies argument smuggling by operation',()=>{
 assert.deepEqual(request.properties.expected_revision,{$ref:'#/$defs/revision'});
 assert.equal(request.$defs.revision.pattern,'^[a-f0-9]{40}$');
 const rules=request.allOf;
 assert.equal(rules.length,request.properties.operation.enum.length);
 for(const rule of rules){
   const operation=rule.if.properties.operation.const;
   assert.ok(request.properties.operation.enum.includes(operation));
   const args=rule.then.properties.args;
   assert.equal(args.additionalProperties,false);
   assert.deepEqual(args.required.sort(),Object.keys(args.properties).sort());
 }
 assert.deepEqual(rules.find(x=>x.if.properties.operation.const==='decision.next')
    .then.properties.args.required.sort(),['node_id','predicate']);
});
