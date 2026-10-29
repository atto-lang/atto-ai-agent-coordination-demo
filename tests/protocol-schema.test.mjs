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
