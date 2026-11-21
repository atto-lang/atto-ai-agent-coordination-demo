// Local HMAC capability contract for a trusted issuer and a separate verifier.
// NOT a distributed identity service or a replacement for authenticated receipts.
import { createHmac, timingSafeEqual } from 'node:crypto';
const allowed = new Set(['create_run','activate','prepare_effect','accept_step','claim_dispatch','reconcile','finish','inspect']);
const scoped = /^[a-zA-Z0-9_-]{1,96}$/;
const sha = /^[a-f0-9]{40}$/;
function require_claims(claims) {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw Error('invalid capability');
  const keys=Object.keys(claims).sort();
  if (keys.join(',') !== ['action','expires_ms','scope'].sort().join(',')) throw Error('invalid capability fields');
  if (!allowed.has(claims.action) || !Number.isSafeInteger(claims.expires_ms)) throw Error('invalid capability action/expiry');
  const s=claims.scope;
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw Error('invalid capability scope');
  if (!scoped.test(s.tenant||'') || !scoped.test(s.run||'') || !sha.test(s.revision||'')) throw Error('invalid capability identity');
  for (const [k,v] of Object.entries(s)) {
    if (!['tenant','run','revision','epoch','version','step','message_id','key','digest','decision','receipt'].includes(k)) throw Error('unknown capability scope');
    if (['epoch','version'].includes(k) ? !Number.isSafeInteger(v) || v<0 : typeof v !== 'string') throw Error('invalid capability value');
  }
}
function key_bytes(key) {
  if (!Buffer.isBuffer(key) || key.length < 32) throw Error('32+ byte secret required');
  return Buffer.from(key);
}
const mac=(key,payload)=>createHmac('sha256',key).update('ores.workflow.capability.v1\0'+payload).digest('base64url');
export class WorkflowCapabilityIssuer {
  #key;
  constructor(key){this.#key=key_bytes(key)}
  issue(action, scope, expires_ms) {
    const claims={action,scope,expires_ms}; require_claims(claims);
    const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
    return 'v1.'+payload+'.'+mac(this.#key,payload);
  }
}
export class WorkflowCapabilityVerifier {
  #key;
  constructor(key){this.#key=key_bytes(key)}
  require(token,action,scope) {
    if (typeof token!=='string' || token.length>2048) throw Error('capability required');
    const segments=token.split('.');
    if (segments.length!==3 || segments[0]!=='v1' ||
        !/^[A-Za-z0-9_-]+$/.test(segments[1]) ||
        !/^[A-Za-z0-9_-]{43}$/.test(segments[2])) throw Error('invalid capability encoding');
    const expected=Buffer.from(mac(this.#key,segments[1]));
    const supplied=Buffer.from(segments[2]);
    if (!timingSafeEqual(expected,supplied)) throw Error('invalid capability signature');
    const decoded=Buffer.from(segments[1],'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url')!==segments[1]) throw Error('noncanonical capability');
    let claims;try{claims=JSON.parse(decoded)}catch{throw Error('invalid capability payload')}
    require_claims(claims);
    const now=Date.now();
    if (claims.expires_ms<=now || claims.expires_ms>now+300000) throw Error('expired or oversized capability TTL');
    if (claims.action!==action || JSON.stringify(claims.scope)!==JSON.stringify(scope))
      throw Error('capability not authorized for this action');
    return true;
  }
}
