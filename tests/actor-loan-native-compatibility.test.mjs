// This is intentionally a RED native-capability gate until AI actors are
// redesigned around typed mail/replies and void scoped state callbacks.
// Structural ownership tests alone must not report a compiler-valid actor API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../src/', import.meta.url);
const paths = [root, new URL('memory/', root), new URL('runtime/', root)]
  .flatMap(url => readdirSync(url)
    .filter(name => name.endsWith('.ores')).map(name => new URL(name, url)));

test('state loans do not fabricate value-returning actor methods', () => {
  assert.equal(paths.length, 20);
  const incompatible = paths.flatMap(url => {
    const source = readFileSync(url, 'utf8');
    return [...source.matchAll(/return\s+self\.handle_state\s*\(/g)]
      .map(() => url.pathname.replace(/^.*\/src\//, 'src/'));
  });
  assert.deepEqual(incompatible, [],
    'ActorStateLoanTest on compiler draft #1806 types handle_state as void. ' +
    'Implement typed mailbox replies and detached post-loan output, or first ' +
    'land a verified safe return-value contract in the compiler. ' +
    incompatible.length + ' incompatible method sites remain.');
});

test('known void state transition does not forge a state-loan result', () => {
  const source = readFileSync(new URL('../src/decision_gate.ores', import.meta.url), 'utf8');
  const method = source.match(/pub invalidate\(\): void[\s\S]*?(?=\n  pub |\nend\s*$)/)?.[0];
  assert.ok(method, 'void invalidation method must exist');
  assert.match(method, /self\.handle_state\(critical \|s\| -> \{/);
  assert.doesNotMatch(method, /return\s+self\.handle_state/);
});
