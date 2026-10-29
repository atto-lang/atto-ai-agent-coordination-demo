// Local native-evidence consistency checks. Not a compiler build attestation
// and not a trust boundary against a compromised compiler or trusted runner.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const dirs = new Map([['src', 8], ['src/memory', 9], ['src/runtime', 3], ['tests/guest', 2]]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function receiptFromOutput(stdout, prefix) {
  if (typeof stdout !== 'string') throw Error('non-text native output');
  const hits = stdout.split(/\r?\n/).filter(x => x.startsWith(prefix + ' '));
  if (hits.length !== 1) throw Error('missing or duplicate ' + prefix + ' receipt');
  let receipt;
  try { receipt = JSON.parse(hits[0].slice(prefix.length + 1)); }
  catch { throw Error('malformed ' + prefix + ' JSON'); }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt))
    throw Error('invalid ' + prefix + ' object');
  return receipt;
}


// A future subdirectory must not become an unaudited bypass around the exact
// manifest. Reject symlinks even if they happen to resolve within the tree.
function assertCompleteActorCoverage(demo, manifest) {
  const allowed = new Set(manifest);
  const stack = ['src'];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(join(demo, dir), { withFileTypes: true })) {
      const path = dir + '/' + entry.name;
      if (entry.isSymbolicLink()) throw Error('symlink in actor source tree: ' + path);
      if (entry.isDirectory()) { stack.push(path); continue; }
      if (entry.name.endsWith('.ores') && (!entry.isFile() || !allowed.has(path)))
        throw Error('unlisted native actor source: ' + path);
    }
  }
}

function manifestFromTree(demo) {
  const paths = [];
  for (const [dir, minCount] of dirs) {
    const root = join(demo, dir);
    if (!lstatSync(root).isDirectory()) throw Error('not a source directory: ' + dir);
    const candidates = readdirSync(root, { withFileTypes: true })
      .filter(x => x.name.endsWith('.ores'));
    if (candidates.length < minCount)
      throw Error('insufficient native source files in ' + dir);
    for (const x of candidates) {
      if (!x.isFile()) throw Error('nonregular .ores source: ' + dir + '/' + x.name);
      paths.push(dir + '/' + x.name);
    }
  }
  assertCompleteActorCoverage(demo, paths);
  return paths.sort();
}

export function verifyNativeCheck(report, demoPath, expectedCompilerSHA) {
  if (!SHA40.test(expectedCompilerSHA) ||
      report?.compiler_source_head !== expectedCompilerSHA ||
      report.passed !== true || !Number.isSafeInteger(report.checked) ||
      !Number.isSafeInteger(report.required) ||
      report.checked !== report.required ||
      !Array.isArray(report.manifest) || !Array.isArray(report.outcomes) ||
      report.manifest.length !== report.checked ||
      report.outcomes.length !== report.checked)
    throw Error('compiler-check summary mismatch');

  const demo = realpathSync(resolve(demoPath));
  const expectedFiles = manifestFromTree(demo);
  if (expectedFiles.length !== report.checked)
    throw Error('compiler-check file count mismatch');
  for (let i = 0; i < expectedFiles.length; i++) {
    const file = expectedFiles[i];
    const entry = report.outcomes[i];
    if (report.manifest[i] !== file || !entry || entry.file !== file ||
        entry.passed !== true || entry.exit_code !== 0 ||
        entry.signal !== null || !SHA256.test(entry.source_sha256))
      throw Error('unverified compiler-check outcome: ' + file);
    const fullPath = join(demo, file);
    const canonical = realpathSync(fullPath);
    const rel = relative(demo, canonical);
    if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel) ||
        !lstatSync(fullPath).isFile())
      throw Error('native source escapes demo tree: ' + file);
    if (sha256(readFileSync(fullPath)) !== entry.source_sha256)
      throw Error('native source hash mismatch: ' + file);
  }
  const actorCount = expectedFiles.filter(x => x.startsWith('src/')).length;
  const guestCount = expectedFiles.filter(x => x.startsWith('tests/guest/')).length;
  const expectedGuests = ['tests/guest/agent_pipeline.ores', 'tests/guest/direct_agent_hop.ores'];
  if (actorCount < 20 || guestCount !== 2 ||
      !expectedGuests.every(file => expectedFiles.includes(file)) ||
      report.actor_count !== actorCount)
    throw Error('insufficient native actor or guest coverage');
  const neg = report.negative;
  const negativeFile = 'tests/guest/negative/wrong_actor_mail_type.ores';
  if (!neg || neg.file !== negativeFile || neg.passed !== true ||
      !Number.isInteger(neg.exit_code) || neg.exit_code === 0 ||
      neg.signal !== null ||
      neg.expected_type_error !== 'ActorRef.send mailbox value' ||
      typeof neg.diagnostic !== 'string' ||
      !neg.diagnostic.includes(neg.expected_type_error) ||
      !SHA256.test(neg.source_sha256))
    throw Error('missing targeted negative mailbox type verdict');
  const negativePath = join(demo, negativeFile);
  if (!lstatSync(negativePath).isFile() ||
      sha256(readFileSync(negativePath)) !== neg.source_sha256)
    throw Error('negative type-check source identity mismatch');
  return { checked_actors: actorCount, checked_guest_sources: guestCount,
    positive_native_checks: report.checked, negative_native_checks: 1,
    manifest_sha256: sha256(Buffer.from(expectedFiles.join('\n') + '\n')) };
}

export function verifyNativeGuest(report, demoPath, expectedCompilerSHA) {
  if (!SHA40.test(expectedCompilerSHA) ||
      report?.compiler_source_head !== expectedCompilerSHA ||
      report.passed !== true || report.cases_required !== 2 ||
      report.cases_executed !== 2 || !Array.isArray(report.results) ||
      report.results.length !== 2)
    throw Error('native guest summary mismatch');
  const demo = realpathSync(resolve(demoPath));
  const names = ['agent_pipeline', 'direct_agent_hop'];
  const hashes = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const entry = report.results[i];
    if (!entry || entry.name !== name || entry.passed !== true ||
        entry.exit_code !== 0 || entry.signal !== null ||
        entry.error !== null || entry.stdout_exact !== true ||
        !SHA256.test(entry.source_sha256) || !SHA256.test(entry.oracle_sha256))
      throw Error('native guest execution receipt mismatch: ' + name);
    for (const [extension, expected] of [
      ['.ores', entry.source_sha256], ['.stdout', entry.oracle_sha256]
    ]) {
      const path = join(demo, 'tests/guest/' + name + extension);
      if (!lstatSync(path).isFile() || sha256(readFileSync(path)) !== expected)
        throw Error('native guest source or oracle mismatch: ' + name);
    }
    hashes.push({name, source_sha256: entry.source_sha256,
      oracle_sha256: entry.oracle_sha256});
  }
  return { guest_scenarios: names.length, verified_guest_hashes: hashes };
}
