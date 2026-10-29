// Local native-evidence consistency checks. Not a compiler build attestation
// and not a trust boundary against a compromised compiler or trusted runner.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const dirs = new Map([['src', 8], ['src/memory', 9], ['src/runtime', 3], ['tests/guest', 1]]);
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
  if (actorCount < 20 || guestCount < 1)
    throw Error('insufficient native actor or guest coverage');
  return { checked_actors: actorCount, checked_guest_sources: guestCount,
    manifest_sha256: sha256(Buffer.from(expectedFiles.join('\n') + '\n')) };
}

export function verifyNativeGuest(report, demoPath, expectedCompilerSHA) {
  if (!SHA40.test(expectedCompilerSHA) || report?.test !== 'agent_pipeline' ||
      report.compiler_source_head !== expectedCompilerSHA ||
      report.compiler_worktree_clean !== true ||
      report.passed !== true || report.executed !== true ||
      report.exit_code !== 0 || report.signal !== null ||
      report.stdout_exact !== true ||
      !SHA256.test(report.fixture_sha256) || !SHA256.test(report.oracle_sha256))
    throw Error('native guest receipt mismatch');
  const demo = realpathSync(resolve(demoPath));
  const sources = [
    ['tests/guest/agent_pipeline.ores', report.fixture_sha256],
    ['tests/guest/agent_pipeline.stdout', report.oracle_sha256]
  ];
  for (const [file, digest] of sources) {
    const target = join(demo, file);
    if (!lstatSync(target).isFile() || sha256(readFileSync(target)) !== digest)
      throw Error('guest source/oracle drift: ' + file);
  }
  return { guest_scenarios: 1,
    guest_fixture_sha256: report.fixture_sha256,
    guest_oracle_sha256: report.oracle_sha256 };
}
