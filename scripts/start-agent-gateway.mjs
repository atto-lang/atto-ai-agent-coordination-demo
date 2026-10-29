#!/usr/bin/env node
// Local read-only interoperability smoke; no Oreslang runtime, no effect APIs.
import { create_agent_gateway } from '../reference/agent-gateway.mjs';
const token = process.env.ORES_AGENT_DEMO_TOKEN ?? '';
const revision = process.env.ORES_AGENT_DEMO_REVISION ?? '';
if (Buffer.byteLength(token) < 32 || !/^[a-f0-9]{40}$/.test(revision)) {
  console.error('Set ORES_AGENT_DEMO_TOKEN (32+ bytes) and ORES_AGENT_DEMO_REVISION (40-hex Git SHA)');
  process.exit(2);
}
const graph = {revision, entities: {'repo:oreslang': {
  id:'repo:oreslang', label:'Oreslang', kind:'repository'
}}, edges: {'repo:oreslang':['module:actors']}};
const decision = {next: (node, predicate) => {
  if (node !== 'review') throw Error('unknown decision node');
  return predicate ? 'approved' : 'research';
}};
const workflow = {id:'demo-workflow', revision, status:'planned'};
const server = create_agent_gateway({token, graph, decision, workflow});
server.listen(0, '127.0.0.1', () => {
  console.log('AGENT_GATEWAY_LOOPBACK_PORT=' + server.address().port);
});
