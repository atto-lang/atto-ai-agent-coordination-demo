// Reference HTTP protocol for external Python/TypeScript agents.
// LOCAL-ONLY, read-only, fixed demo tenant. This does not call native Oreslang.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const operations = new Set(['knowledge.get_entity', 'knowledge.neighbors',
  'decision.next', 'workflow.status']);
const identifier = x => typeof x === 'string' && /^[\w.:-]{1,128}$/.test(x);
const keysEqual = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every(x => allowed.includes(x));
};
const privateLoopback = value => value === '127.0.0.1' || value === '::1' ||
  value === '::ffff:127.0.0.1';
const send = (res, status, payload) => {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  res.end(JSON.stringify({ schema_version:1, ...payload }));
};
const deny = (res, status, error, request_id=null) =>
  send(res, status, { request_id, ok:false, error });

export function create_agent_gateway({token, graph, decision, workflow}) {
  if (typeof token !== 'string' || Buffer.byteLength(token) < 32)
    throw Error('explicit bearer token of at least 32 bytes required');
  const secret = Buffer.from('Bearer ' + token);
  const server = createServer((req,res) => {
    // Fail closed even if an embedding application accidentally listen()s
    // on 0.0.0.0; loopback is not a substitute for authenticated policy.
    if (!privateLoopback(req.socket.localAddress) ||
        !privateLoopback(req.socket.remoteAddress))
      return deny(res,403,'loopback only');
    if (req.method !== 'POST' || req.url !== '/v1/request')
      return deny(res,404,'unknown endpoint');
    const header = req.headers.authorization;
    const provided = Buffer.from(typeof header === 'string' ? header : '');
    if (provided.length !== secret.length || !timingSafeEqual(provided,secret))
      return deny(res,401,'unauthorized');
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
      return deny(res,415,'JSON content type required');
    if ((req.headers['content-encoding'] || 'identity') !== 'identity')
      return deny(res,415,'compressed request forbidden');
    const announced = req.headers['content-length'];
    if (announced !== undefined && (!/^\d+$/.test(announced) || Number(announced)>16384))
      return deny(res,413,'request too large');

    const chunks=[]; let bytes=0; let rejected=false;
    req.on('data', part => {
      if (rejected) return;
      bytes += part.length;
      if (bytes > 16384) {
        rejected=true;
        deny(res,413,'request too large');
        req.resume();  // consume without buffering the rest
        return;
      }
      chunks.push(part);
    });
    req.on('error', () => { rejected=true; });
    req.on('end', () => {
      if (rejected) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return deny(res,400,'invalid JSON'); }
      if (!keysEqual(body,['schema_version','request_id','tenant_id','actor_id',
        'expected_revision','operation','args']))
        return deny(res,400,'invalid envelope');
      const {schema_version,request_id,tenant_id,actor_id,
        expected_revision,operation,args} = body;
      if (schema_version !== 1 || !identifier(request_id) ||
          !identifier(tenant_id) || !identifier(actor_id) ||
          !/^[a-f0-9]{40}$/.test(expected_revision) ||
          !operations.has(operation))
        return deny(res,400,'invalid envelope');
      if (tenant_id !== 'demo' || actor_id !== 'repo-graph')
        return deny(res,403,'unknown tenant/actor',request_id);
      if (expected_revision !== graph.revision)
        return deny(res,409,'revision mismatch',request_id);
      const required = {
        'knowledge.get_entity':['id'], 'knowledge.neighbors':['id'],
        'decision.next':['node_id','predicate'], 'workflow.status':['id']
      }[operation];
      if (!keysEqual(args,required)) return deny(res,422,'invalid arguments',request_id);
      let value;
      try {
        switch(operation) {
          case 'knowledge.get_entity':
            if (!identifier(args.id)) throw Error('invalid arguments');
            value = Object.hasOwn(graph.entities,args.id) ? graph.entities[args.id] : null;
            break;
          case 'knowledge.neighbors':
            if (!identifier(args.id)) throw Error('invalid arguments');
            value = (Object.hasOwn(graph.edges,args.id) ? graph.edges[args.id] : []).slice(0,128);
            break;
          case 'decision.next':
            if (!identifier(args.node_id) || typeof args.predicate !== 'boolean')
              throw Error('invalid arguments');
            value = decision.next(args.node_id,args.predicate,expected_revision);
            break;
          case 'workflow.status':
            if (!identifier(args.id) || args.id !== workflow.id) throw Error('invalid arguments');
            value={id:workflow.id,status:workflow.status,revision:workflow.revision};
            break;
        }
      } catch { return deny(res,422,'request rejected',request_id); }
      const response={request_id,ok:true,value};
      // Data owned by the service can still be too large; enforce an egress
      // cap to avoid unbounded payloads or accidental mass disclosure.
      let encoded;
      try { encoded = JSON.stringify({schema_version:1,...response}); }
      catch { return deny(res,500,'response encoding failed',request_id); }
      if (Buffer.byteLength(encoded)>16384)
        return deny(res,413,'response too large',request_id);
      res.writeHead(200,{'content-type':'application/json; charset=utf-8',
        'cache-control':'no-store','x-content-type-options':'nosniff'});
      res.end(encoded);
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  return server;
}
