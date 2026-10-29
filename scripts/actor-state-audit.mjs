// Source-structure guard only. This does not parse, typecheck, or execute Oreslang.
// The native compiler and guest acceptance gate remain mandatory.
export function auditActorSource(source) {
  const problems = [];
  const declaration = source.match(/^define isolated actor (\w+) as$/m);
  if (!declaration) problems.push('missing isolated actor declaration');
  const schema = source.match(/^  state \{\n([\s\S]*?)^  \}$/m);
  if (!schema || [...source.matchAll(/^  state \{/gm)].length !== 1)
    problems.push('expected exactly one state schema');
  const fields = new Map();
  if (schema) for (const line of schema[1].split('\n').filter(x => x.trim())) {
    const field = line.match(/^    (\w+):\s*(Array<[^>]+>|int|bool|String)\s*=\s*.+;$/);
    if (!field || fields.has(field[1]))
      problems.push('bad or duplicate state field: ' + line.trim());
    else fields.set(field[1], field[2]);
  }
  if (/^  let /m.test(source) || /\bisoactor\b|\bpub\s+fnc\b/.test(source))
    problems.push('legacy actor fields or declaration');
  if (/\bself\.(?!handle_state\()/g.test(source))
    problems.push('direct actor state access');
  if (!source.trimEnd().endsWith('\nend'))
    problems.push('missing actor end');

  let methods = 0, writes = 0, reads = 0;
  for (const match of source.matchAll(/^  pub (\w+)\(/gm)) {
    methods++;
    const name = match[1], open = source.indexOf('{', match.index);
    if (open < 0) { problems.push(name + ': missing method body'); continue; }
    let depth = 0, end = -1;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) { end = i; break; }
    }
    if (end < 0) { problems.push(name + ': unbalanced method'); continue; }
    const signature = source.slice(match.index, open);
    const body = source.slice(open + 1, end);
    const critical = body.includes('self.handle_state(critical |s| -> {');
    const read = body.includes('self.handle_state(|s| -> {');
    if (critical === read)
      problems.push(name + ': must have exactly one inline loan kind');
    if ((body.match(/self\.handle_state\(/g) || []).length !== 1)
      problems.push(name + ': multiple state loans');
    if (/\b(?:await|spawn)\b|rt\s+cooperate|\bstdio\./.test(body))
      problems.push(name + ': IO or suspension inside state loan');
    for (const access of body.matchAll(/\bs\.(\w+)/g))
      if (!fields.has(access[1]))
        problems.push(name + ': undeclared state ' + access[1]);
    const written = /\bs\.\w+(?:\[[^\]]+\])?\s*=(?!=)|\bs\.\w+\.(?:add|remove|clear|push|pop|set|delete)\s*\(/.test(body);
    if (written && !critical)
      problems.push(name + ': mutation outside critical');
    if (written && !/with\s+state\.write|with\s+state\.read\s*,\s*state\.write/.test(signature))
      problems.push(name + ': missing write effect');
    if (!written && critical)
      problems.push(name + ': unnecessary critical write admission');
    if (!written && !/with\s+state\.read\b/.test(signature))
      problems.push(name + ': missing read effect');
    // A state-backed Array cannot be returned, passed, or stored in a local
    // alias. Borrowed iteration ("for (... of s.items)") is admitted inside
    // the loan; indexing or member operations do not expose Array identity.
    // Deliberately conservative until verified detached-snapshot lowering.
    for (const [field, type] of fields) {
      if (!type.startsWith('Array<')) continue;
      const accesses = new RegExp('\\bs\\.' + field + '\\b(?!\\s*(?:\\.|\\[))', 'g');
      for (const access of body.matchAll(accesses)) {
        const prefix = body.slice(body.lastIndexOf('\n', access.index - 1) + 1, access.index);
        if (/\bof\s*$/.test(prefix)) continue;
        // Replacing the owned field with a new value is a write, not an
        // escape of the previous Array. Plain '=' only; '==' is not a write.
        const suffix = body.slice(access.index + 2 + field.length);
        if (/^\s*=(?!=)/.test(suffix)) continue;
        problems.push(name + ': exposed actor-owned state array ' + field);
      }
    }
    if (written) writes++;
    else reads++;
  }
  if (methods === 0) problems.push('no methods');
  return { actor: declaration?.[1], fields: fields.size, methods, writes, reads, problems };
}
