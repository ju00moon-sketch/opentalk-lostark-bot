import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';

const VALID_ID = /^[1-9][0-9]{0,15}$/;
const FILE = /^kakao-[a-f0-9]{64}\.json$/;
const TEMPORARY = /^kakao-[a-f0-9]{64}\.json\.[a-f0-9]{24}\.tmp$/;

export function createUnlinkInbox(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077))) {
    throw new Error('Unlink inbox directory must be private');
  }
  const filename = (userId) => `kakao-${createHash('sha256').update(userId).digest('hex')}.json`;
  function syncDirectory() {
    if (process.platform === 'win32') return;
    const fd = openSync(directory, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  // Only a renamed and synced event can have been acknowledged.
  // The service must have a single process owning this directory.
  for (const name of readdirSync(directory).filter((item) => TEMPORARY.test(item))) {
    const path = join(directory, name);
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid unlink inbox temporary file');
    unlinkSync(path);
    syncDirectory();
  }
  function files() { return readdirSync(directory).filter((name) => FILE.test(name)); }
  function read(name) {
    const path = join(directory, name);
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 128) throw new Error('Invalid unlink inbox entry');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!VALID_ID.test(value.userId || '') || !Number.isSafeInteger(Number(value.userId)) || filename(value.userId) !== name) {
      throw new Error('Invalid unlink inbox entry');
    }
    return value.userId;
  }
  return {
    enqueue(userId) {
      const name = filename(userId);
      const target = join(directory, name);
      if (existsSync(target)) { read(name); syncDirectory(); return; }
      if (files().length >= 10000) throw new Error('Unlink inbox capacity reached');
      const temporary = join(directory, `${name}.${randomBytes(12).toString('hex')}.tmp`);
      let fd;
      try {
        fd = openSync(temporary, 'wx', 0o600);
        writeFileSync(fd, JSON.stringify({ userId }), 'utf8');
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        renameSync(temporary, target);
        syncDirectory();
      } finally {
        if (fd !== undefined) closeSync(fd);
        if (existsSync(temporary)) unlinkSync(temporary);
      }
    },
    has(userId) { return existsSync(join(directory, filename(userId))); },
    hasAny() { return files().length > 0; },
    pending() { return files().slice(0, 10).map(read); },
    remove(userId) {
      const target = join(directory, filename(userId));
      if (existsSync(target)) { unlinkSync(target); syncDirectory(); }
    },
  };
}
