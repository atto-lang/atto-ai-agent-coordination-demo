#!/usr/bin/env node
// One-command native acceptance sequence; aborts on any missing compiler gate.
// Does not claim persistence, supervisor recovery or multi-backend parity.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const scripts = ['check-native-actors.mjs', 'run-native-guest.mjs'];
for (const script of scripts) {
  const file = fileURLToPath(new URL(script, import.meta.url));
  const result = spawnSync(process.execPath, [file], {
    env: process.env, encoding: 'utf8', timeout: 360000,
    maxBuffer: 3*1024*1024, shell: false
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.signal || result.status !== 0) {
    console.error('NATIVE_ACCEPTANCE_UNVERIFIED gate=' + script);
    process.exit(1);
  }
}
console.log('NATIVE_ACCEPTANCE_RESULT {"checked_actors":8,"guest_scenarios":1,"passed":true,"scope":"Java checks and one guest stdout; no crash recovery"}');
