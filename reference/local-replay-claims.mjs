// SINGLE-HOST local-filesystem durable receipt claims. NOT a distributed CAS.
// A trusted operator creates/owns a 0700 directory on a local filesystem.
import { createHash } from 'node:crypto';
import { constants, lstatSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

const ID = /^[A-Za-z0-9_.:@/-]{1,128}$/;
export function create_local_replay_claims(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory))
    throw new TypeError('absolute, trusted local claims directory required');
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0))
    throw new TypeError('local claim directory must be private and non-symlink');
  return async function claimReceipt(issuer, receipt_id) {
    if (typeof issuer !== 'string' || !ID.test(issuer) ||
        typeof receipt_id !== 'string' || !ID.test(receipt_id)) return false;
    const hash = createHash('sha256').update(issuer).update('\0').update(receipt_id).digest('hex');
    const file = join(directory, hash + '.claim');
    let fd;
    try {
      const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
        (constants.O_NOFOLLOW || 0);
      fd = openSync(file, flags, 0o600);
      const record = Buffer.from(JSON.stringify({issuer, receipt_id}) + '\n');
      if (writeSync(fd, record) !== record.length) throw Error('short receipt write');
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      const dirfd = openSync(directory, constants.O_RDONLY | (constants.O_DIRECTORY || 0));
      try { fsyncSync(dirfd); } finally { closeSync(dirfd); }
      return true;
    } catch (e) {
      if (e?.code === 'EEXIST') return false;
      // If disk/fsync error occurs, an existing record may block retries;
      // never claim success after an ambiguous persistence outcome.
      throw e;
    } finally { if (fd !== undefined) closeSync(fd); }
  };
}
