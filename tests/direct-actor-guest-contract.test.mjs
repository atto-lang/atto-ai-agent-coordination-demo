import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guest = readFileSync(new URL('./guest/direct_agent_hop.ores', import.meta.url), 'utf8');
const oracle = readFileSync(new URL('./guest/direct_agent_hop.stdout', import.meta.url), 'utf8');
const checker = readFileSync(new URL('../scripts/check-native-actors.mjs', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/run-native-guest.mjs', import.meta.url), 'utf8');

test('direct mailbox fixture transfers typed actor capability to the research worker', () => {
  assert.match(guest, /receive\(ActorMail<ActorRef<DirectAnalysisAgent>> mail\)/);
  assert.match(guest, /researcher\.send\(analyzer\)/);
  assert.match(guest, /mail\.value\.send\("evidence-ready"\)/);
  assert.match(guest, /receive\(ActorMail<String> mail\)/);
  assert.doesNotMatch(guest, /\s+pipe\s+spawn\b/);
});

test('direct hop oracle is exact, worker-to-worker edge has no main-mediated forwarding', () => {
  assert.equal(oracle, 'evidence-ready|approved|executed');
  assert.doesNotMatch(guest, /analyzer\.send\(/);
  assert.match(guest, /executor\.send\(decision\.value\)/);
  assert.match(guest, /await researcher\.get_done\(\)/);
  assert.match(guest, /await analyzer\.get_done\(\)/);
  assert.match(guest, /await executor\.get_done\(\)/);
});

test('native check and executed guest runners gate both scenarios', () => {
  assert.match(checker, /tests\/guest\/direct_agent_hop\.ores/);
  assert.match(checker, /tests\/guest\/agent_pipeline\.ores/);
  assert.match(runner, /'agent_pipeline'/);
  assert.match(runner, /'direct_agent_hop'/);
  assert.match(runner, /results\.length === cases\.length/);
  assert.match(runner, /run\.status === 0/);
  assert.match(runner, /run\.stdout\.equals\(expected\)/);
});
