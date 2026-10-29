// Reference network-facing protocol for external TypeScript/Python agents.
// Loopback-only, read-only, token-gated, no tools/LLM/effects.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const names = new Set(['knowledge.get_entity','knowledge.neighbors',
  'decision.next','workflow.status']);
const valid = (x) => typeof x === 'string' && /^[\w.:-]{1,128}$/.test(x);
const deny = (res, code, error, request_id = null) => {
  res.writeHead(code, {'content-type':'application/json', 'cache-control':'no-store'});
  res.end(JSON.stringify({schema_version:1, request_id, ok:false, error}));
};
export function create_agent_gateway({ token, graph, decision, workflow }) {
  if (typeof token !== 'string' || Buffer.byteLength(token) < 32)
    throw Error('explicit bearer token of at least 32 bytes required');
  const secret = Buffer.from('Bearer ' + token);
  return createServer((req,res) => {
    if (req.method !== 'POST' || req.url !== '/v1/request')
      return deny(res,404,'unknown endpoint');
    const provided = Buffer.from(req.headers.authorization || '');
    if (provided.length !== secret.length || !timingSafeEqual(provided,secret))
      return deny(res,401,'unauthorized');
    const chunks=[]; let bytes=0; let oversized=false;
    req.on('data', part => {
      bytes+=part.length;
      if(bytes>16384){ oversized=true; req.pause(); deny(res,413,'request too large'); req.destroy(); }
      else chunks.push(part);
    });
    req.on('end', () => {
      if(oversized) return;
      let body;
      try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return deny(res,400,'invalid JSON'); }
      const {schema_version, request_id, tenant_id, actor_id,
        expected_revision, operation, args} = body ?? {};
      if (schema_version!==1 || !valid(request_id) || !valid(tenant_id) ||
          !valid(actor_id) || !valid(expected_revision) || !names.has(operation) ||
          !args || typeof args!=='object' || Array.isArray(args))
        return deny(res,400,'invalid envelope');
      if (tenant_id!=='demo' || actor_id!=='repo-graph')
        return deny(res,403,'unknown tenant/actor',request_id);
      if (expected_revision!==graph.revision)
        return deny(res,409,'revision mismatch',request_id);
      let value;
      try {
        switch(operation){
          case 'knowledge.get_entity':
            if(!valid(args.id)) throw Error('invalid entity id');
            value=graph.entities[args.id]??null; break;
          case 'knowledge.neighbors':
            if(!valid(args.id)) throw Error('invalid entity id');
            value=(graph.edges[args.id]??[]).slice(0,128); break;
          case 'decision.next':
            if(!valid(args.node_id) || typeof args.predicate!=='boolean')
              throw Error('invalid decision inputs');
            value=decision.next(args.node_id,args.predicate,expected_revision); break;
          case 'workflow.status':
            if(!valid(args.id) || args.id!==workflow.id) throw Error('invalid workflow');
            value={id:workflow.id,status:workflow.status,revision:workflow.revision}; break;
        }
      } catch (err) { return deny(res,422,String(err.message),request_id); }
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({schema_version:1,request_id,ok:true,value}));
    });
  });
}
