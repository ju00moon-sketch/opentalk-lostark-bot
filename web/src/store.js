import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createGuildStore, GUILD_SCHEMA } from './guild-store.js';

export function createStore(path) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink() || (existsSync(path) && lstatSync(path).isSymbolicLink())) {
    throw new Error('Authentication storage cannot use symbolic links');
  }
  if (process.platform !== 'win32' && (lstatSync(directory).mode & 0o077)) {
    throw new Error('Authentication storage directory must be private');
  }
  const db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=250; PRAGMA secure_delete=ON;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (![0, 1, 2, 3, 4].includes(version)) throw new Error('Unsupported authentication database version');
    if (version === 0 && db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().count) {
      throw new Error('Authentication database must be a dedicated store');
    }
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('discord', 'kakao')),
        provider_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (provider, provider_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        authenticated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS oauth_transactions (
        state_hash TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('discord', 'kakao')),
        binding_hash TEXT NOT NULL,
        verifier TEXT NOT NULL,
        epoch INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS transactions_expiration ON oauth_transactions(expires_at);
      CREATE TABLE IF NOT EXISTS provider_epochs (provider TEXT PRIMARY KEY, epoch INTEGER NOT NULL) STRICT;
      INSERT OR IGNORE INTO provider_epochs VALUES ('discord', 0), ('kakao', 0);
      CREATE TABLE IF NOT EXISTS deletion_intents (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
        attempts INTEGER NOT NULL,
        next_attempt INTEGER NOT NULL
      ) STRICT;
      ${GUILD_SCHEMA}
      ${version < 4 ? `INSERT OR IGNORE INTO guild_manual_reviews
        SELECT user_id, COALESCE(reviewed_at, applied_at) FROM guild_memberships
        WHERE status IN ('rejected', 'revoked') OR (status='pending' AND revision>1);` : ''}
      PRAGMA user_version=4;
      COMMIT;
    `);
    for (const suffix of ['-wal', '-shm']) if (existsSync(path + suffix)) chmodSync(path + suffix, 0o600);
  } catch (error) {
    db.close();
    throw error;
  }

  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function removeExpired(timestamp) {
    db.prepare('DELETE FROM oauth_transactions WHERE expires_at <= ?').run(timestamp);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(timestamp);
    db.prepare('DELETE FROM guild_verifications WHERE expires_at <= ?').run(timestamp);
    db.prepare('DELETE FROM guild_auto_transactions WHERE expires_at <= ?').run(timestamp);
  }
  function advanceEpoch(provider) {
    db.prepare('UPDATE provider_epochs SET epoch=epoch+1 WHERE provider=?').run(provider);
    db.prepare('DELETE FROM oauth_transactions WHERE provider=?').run(provider);
  }

  return {
    guild: createGuildStore(db, transaction),
    cleanup(timestamp) { transaction(() => removeExpired(timestamp)); },
    healthy() {
      if (db.prepare('SELECT 1 FROM deletion_intents LIMIT 1').get()) throw new Error('Account deletion requires completion');
      db.prepare('SELECT 1').get();
    },
    addTransaction({ stateHash, provider, bindingHash, verifier, expiresAt }, timestamp) {
      return transaction(() => {
        removeExpired(timestamp);
        if (db.prepare('SELECT COUNT(*) AS count FROM oauth_transactions').get().count >= 1000) return false;
        const { epoch } = db.prepare('SELECT epoch FROM provider_epochs WHERE provider=?').get(provider);
        db.prepare('INSERT INTO oauth_transactions VALUES (?, ?, ?, ?, ?, ?)').run(stateHash, provider, bindingHash, verifier, epoch, expiresAt);
        return true;
      });
    },
    consumeTransaction(stateHash, provider, bindingHash, timestamp) {
      return transaction(() => {
        removeExpired(timestamp);
        const row = db.prepare('SELECT verifier, epoch FROM oauth_transactions WHERE state_hash = ? AND provider = ? AND binding_hash = ? AND expires_at > ?').get(stateHash, provider, bindingHash, timestamp);
        if (row) db.prepare('DELETE FROM oauth_transactions WHERE state_hash = ?').run(stateHash);
        return row;
      });
    },
    createSession({ provider, providerId, displayName, tokenHash, oldTokenHash, expiresAt, epoch }, timestamp) {
      return transaction(() => {
        removeExpired(timestamp);
        if (db.prepare('SELECT epoch FROM provider_epochs WHERE provider=?').get(provider).epoch !== epoch) return 'invalid_request';
        if (db.prepare('SELECT 1 FROM deletion_intents WHERE provider_id=?').get(providerId) && provider === 'kakao') return 'deletion_pending';
        db.prepare(`INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider, provider_id) DO UPDATE SET display_name=excluded.display_name, updated_at=excluded.updated_at`).run(randomUUID(), provider, providerId, displayName, timestamp, timestamp);
        const user = db.prepare('SELECT id FROM users WHERE provider = ? AND provider_id = ?').get(provider, providerId);
        if (oldTokenHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(oldTokenHash);
        db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(tokenHash, user.id, timestamp, expiresAt);
        return null;
      });
    },
    getSession(tokenHash, timestamp) {
      return db.prepare(`SELECT users.id, users.provider, users.display_name AS displayName FROM sessions
        JOIN users ON users.id=sessions.user_id WHERE token_hash = ? AND expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM deletion_intents WHERE user_id=users.id)`).get(tokenHash, timestamp);
    },
    // Internal identity lookup; callers must use the session authorization gate first.
    identity(userId) {
      return db.prepare('SELECT id, provider, provider_id AS providerId FROM users WHERE id=? AND NOT EXISTS (SELECT 1 FROM deletion_intents WHERE user_id=users.id)').get(userId);
    },
    getAccount(tokenHash, timestamp) {
      return db.prepare(`SELECT users.id, users.provider, users.provider_id AS providerId, sessions.authenticated_at AS authenticatedAt
        FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?`).get(tokenHash, timestamp);
    },
    deleteSession(tokenHash) { transaction(() => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)); },
    deleteLocalAccount(userId) {
      transaction(() => {
        const account = db.prepare('SELECT provider FROM users WHERE id=?').get(userId);
        if (account) {
          advanceEpoch(account.provider);
          db.prepare('DELETE FROM users WHERE id=?').run(userId);
        }
      });
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    },
    beginDeletion(account, timestamp) {
      transaction(() => {
        db.prepare('INSERT OR IGNORE INTO deletion_intents VALUES (?, ?, 0, 0, ?)').run(account.id, account.providerId, timestamp + 60000);
      });
    },
    deletion(userId) { return db.prepare('SELECT user_id AS userId, provider_id AS providerId, confirmed, attempts FROM deletion_intents WHERE user_id=?').get(userId); },
    confirmDeletion(userId) { transaction(() => db.prepare('UPDATE deletion_intents SET confirmed=1 WHERE user_id=?').run(userId)); },
    retryDeletion(userId, timestamp) {
      transaction(() => db.prepare('UPDATE deletion_intents SET attempts=attempts+1, next_attempt=? WHERE user_id=?').run(timestamp + 60000, userId));
    },
    pendingDeletions(timestamp) { return db.prepare('SELECT user_id AS userId FROM deletion_intents WHERE next_attempt<=? ORDER BY next_attempt LIMIT 10').all(timestamp); },
    externalUnlink(providerId) {
      transaction(() => {
        advanceEpoch('kakao');
        db.prepare("DELETE FROM users WHERE provider='kakao' AND provider_id=?").run(providerId);
      });
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    },
    close() { db.close(); },
  };
}
