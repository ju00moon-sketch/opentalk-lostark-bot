import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStore } from './store.js';
import { validUserId } from './guild-store.js';

// Run as the web service account with the web service stopped.
// Provider IDs and session credentials are never printed.
export function assignOwner(path, userId, provider) {
  if (!isAbsolute(path) || !validUserId(userId) || !['discord', 'kakao'].includes(provider) || !existsSync(path)) throw new Error('Invalid owner assignment');
  for (const target of [dirname(path), path, `${path}-wal`, `${path}-shm`]) {
    if (!existsSync(target)) continue;
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Owner assignment requires private regular storage');
  }
  const inbox = `${path}.unlink-inbox`;
  if (existsSync(inbox)) {
    const stat = lstatSync(inbox);
    if (stat.isSymbolicLink() || !stat.isDirectory() || readdirSync(inbox).length) throw new Error('Complete pending unlink recovery first');
  }
  const snapshot = new DatabaseSync(path, { readOnly: true });
  try {
    if (snapshot.prepare('PRAGMA user_version').get().user_version !== 4) throw new Error('Deploy and verify the guild schema first');
    const account = snapshot.prepare('SELECT provider FROM users WHERE id=?').get(userId);
    if (account?.provider !== provider) throw new Error('Account and selected provider do not match');
  } finally { snapshot.close(); }
  const store = createStore(path);
  try {
    if (store.identity(userId)?.provider !== provider) throw new Error('Account is no longer available');
    store.guild.bootstrapOwner(userId, Date.now());
  } finally { store.close(); }
  return { assigned: true, userId, provider };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [path, userId, provider, confirmation, ...extra] = process.argv.slice(2);
    if (confirmation !== '--service-stopped' || extra.length) throw new Error('Usage: node src/guild-owner.js ABSOLUTE_DB_PATH ACCOUNT_UUID discord|kakao --service-stopped');
    process.umask(0o077);
    process.stdout.write(`${JSON.stringify(assignOwner(path, userId, provider))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
