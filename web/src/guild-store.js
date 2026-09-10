import { randomInt, timingSafeEqual } from 'node:crypto';

export const GUILD_SCHEMA = `
  CREATE TABLE IF NOT EXISTS guild_memberships (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    character_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    applied_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS guild_roles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'owner')),
    granted_at INTEGER NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS guild_single_owner ON guild_roles(role) WHERE role='owner';
  CREATE UNIQUE INDEX IF NOT EXISTS guild_verified_character ON guild_memberships(lower(character_name))
    WHERE status='approved' AND character_name<>'';
  CREATE TABLE IF NOT EXISTS guild_verifications (
    user_id TEXT PRIMARY KEY REFERENCES guild_memberships(user_id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts BETWEEN 0 AND 5)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS guild_manual_reviews (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    blocked_at INTEGER NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS guild_review_block_insert AFTER INSERT ON guild_memberships
    WHEN NEW.status IN ('rejected', 'revoked') BEGIN
      INSERT OR IGNORE INTO guild_manual_reviews VALUES (NEW.user_id, COALESCE(NEW.reviewed_at, NEW.applied_at));
    END;
  CREATE TRIGGER IF NOT EXISTS guild_review_block_update AFTER UPDATE OF status ON guild_memberships
    WHEN NEW.status IN ('rejected', 'revoked') BEGIN
      INSERT OR IGNORE INTO guild_manual_reviews VALUES (NEW.user_id, COALESCE(NEW.reviewed_at, NEW.applied_at));
    END;
  CREATE TABLE IF NOT EXISTS guild_auto_transactions (
    state_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    binding_hash TEXT NOT NULL,
    verifier TEXT NOT NULL,
    revision INTEGER NOT NULL,
    character_name TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
`;

export class GuildError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const forbidden = () => { throw new GuildError(403, 'forbidden'); };
const conflict = () => { throw new GuildError(409, 'state_changed'); };
export const validCharacter = (value) => typeof value === 'string' && /^[가-힣A-Za-z0-9]{2,12}$/.test(value);
export const validUserId = (value) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

export function createGuildStore(db, transaction) {
  function active(userId) {
    return db.prepare('SELECT id FROM users WHERE id=? AND NOT EXISTS (SELECT 1 FROM deletion_intents WHERE user_id=users.id)').get(userId);
  }
  function membership(userId) {
    return db.prepare(`SELECT character_name AS characterName, status, revision, applied_at AS appliedAt,
      reviewed_at AS reviewedAt FROM guild_memberships WHERE user_id=?`).get(userId) || null;
  }
  function role(userId) { return db.prepare('SELECT role FROM guild_roles WHERE user_id=?').get(userId)?.role || 'member'; }
  function challenge(userId) { return db.prepare('SELECT * FROM guild_verifications WHERE user_id=?').get(userId); }
  function issue(userId, timestamp) {
    let code;
    do { code = String(randomInt(100000000)).padStart(8, '0'); }
    while (db.prepare('SELECT 1 FROM guild_verifications WHERE code=?').get(code));
    db.prepare(`INSERT INTO guild_verifications VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(user_id) DO UPDATE SET code=excluded.code, issued_at=excluded.issued_at,
      expires_at=excluded.expires_at, attempts=0`).run(userId, code, timestamp, timestamp + 1800000);
  }
  function state(userId, timestamp = Date.now()) {
    const currentRole = active(userId) ? role(userId) : 'member';
    const currentMembership = active(userId) ? membership(userId) : null;
    const currentChallenge = currentMembership?.status === 'pending' ? challenge(userId) : null;
    const verification = currentChallenge ? {
      code: currentChallenge.expires_at > timestamp && currentChallenge.attempts < 5 ? currentChallenge.code : null,
      expiresAt: currentChallenge.expires_at, reissueAt: currentChallenge.issued_at + 60000,
      serverNow: timestamp,
      attemptsRemaining: 5 - currentChallenge.attempts,
    } : null;
    return { role: currentRole, membership: currentMembership, canViewSheet: currentMembership?.status === 'approved', verification };
  }
  function requireStaff(userId, ownerOnly = false) {
    const current = state(userId);
    if (!current.canViewSheet || (ownerOnly ? current.role !== 'owner' : !['owner', 'admin'].includes(current.role))) forbidden();
    return current.role;
  }
  function targetRevision(userId, revision) {
    if (!active(userId)) conflict();
    const target = membership(userId);
    if (!target || target.revision !== revision) conflict();
    return target;
  }
  function automaticReason(userId) {
    const user = db.prepare("SELECT provider FROM users WHERE id=?").get(userId);
    if (!active(userId)) return 'state_changed';
    if (user.provider !== 'discord') return 'discord_required';
    if (db.prepare('SELECT 1 FROM guild_manual_reviews WHERE user_id=?').get(userId)) return 'manual_required';
    if (membership(userId)?.status !== 'pending' || role(userId) !== 'member') return 'not_pending';
    return null;
  }
  function requireAutomatic(userId, sessionHash, revision, timestamp) {
    const reason = automaticReason(userId);
    if (reason) throw new GuildError(reason === 'not_pending' ? 409 : 403, `automatic_${reason}`);
    if (!db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?').get(sessionHash, userId, timestamp)) {
      throw new GuildError(409, 'automatic_state_changed');
    }
    return targetRevision(userId, revision);
  }
  return {
    state,
    automaticReason,
    beginAutomatic({ stateHash, userId, sessionHash, bindingHash, verifier, revision }, timestamp) {
      return transaction(() => {
        const target = requireAutomatic(userId, sessionHash, revision, timestamp);
        const identity = db.prepare('SELECT provider_id FROM users WHERE id=?').get(userId);
        db.prepare('DELETE FROM guild_auto_transactions WHERE expires_at<=? OR user_id=?').run(timestamp, userId);
        if (db.prepare('SELECT COUNT(*) AS count FROM guild_auto_transactions').get().count >= 1000) throw new GuildError(429, 'rate_limited');
        db.prepare('INSERT INTO guild_auto_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(stateHash, userId, sessionHash, identity.provider_id, bindingHash, verifier, revision, target.characterName, timestamp + 300000);
      });
    },
    consumeAutomatic(stateHash, bindingHash, sessionHash, timestamp) {
      return transaction(() => {
        const proof = db.prepare(`SELECT user_id AS userId, session_hash AS sessionHash, provider_id AS providerId,
          verifier, revision, character_name AS characterName, expires_at AS expiresAt
          FROM guild_auto_transactions WHERE state_hash=? AND binding_hash=? AND session_hash=? AND expires_at>?`)
          .get(stateHash, bindingHash, sessionHash, timestamp);
        if (proof) db.prepare('DELETE FROM guild_auto_transactions WHERE state_hash=?').run(stateHash);
        return proof;
      });
    },
    finishAutomatic(proof, timestamp) {
      return transaction(() => {
        const target = requireAutomatic(proof.userId, proof.sessionHash, proof.revision, timestamp);
        if (proof.expiresAt <= timestamp || target.characterName !== proof.characterName ||
            db.prepare('SELECT provider_id FROM users WHERE id=?').get(proof.userId)?.provider_id !== proof.providerId) {
          throw new GuildError(409, 'automatic_state_changed');
        }
        if (db.prepare("SELECT 1 FROM guild_memberships WHERE lower(character_name)=lower(?) AND status='approved' AND user_id<>?").get(target.characterName, proof.userId)) {
          throw new GuildError(409, 'character_already_verified');
        }
        db.prepare("UPDATE guild_memberships SET status='approved', revision=revision+1, reviewed_at=?, reviewed_by=NULL WHERE user_id=?").run(timestamp, proof.userId);
        db.prepare('DELETE FROM guild_verifications WHERE user_id=?').run(proof.userId);
      });
    },
    bootstrapOwner(userId, timestamp) {
      return transaction(() => {
        if (!validUserId(userId) || !active(userId)) throw new GuildError(400, 'unknown_account');
        if (db.prepare("SELECT 1 FROM guild_roles WHERE role='owner'").get()) conflict();
        db.prepare(`INSERT INTO guild_memberships VALUES (?, '', 'approved', 1, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET status='approved', revision=revision+1, reviewed_at=excluded.reviewed_at, reviewed_by=excluded.reviewed_by`).run(userId, timestamp, timestamp, userId);
        db.prepare(`INSERT INTO guild_roles VALUES (?, 'owner', ?)
          ON CONFLICT(user_id) DO UPDATE SET role='owner', granted_at=excluded.granted_at`).run(userId, timestamp);
        db.prepare('DELETE FROM guild_verifications WHERE user_id=?').run(userId);
        return state(userId, timestamp);
      });
    },
    apply(userId, characterName, timestamp) {
      if (!validCharacter(characterName)) throw new GuildError(400, 'invalid_request');
      return transaction(() => {
        if (!active(userId)) forbidden();
        const current = membership(userId);
        if (current && !['rejected', 'revoked'].includes(current.status)) conflict();
        db.prepare(`INSERT INTO guild_memberships VALUES (?, ?, 'pending', 1, ?, NULL, NULL)
          ON CONFLICT(user_id) DO UPDATE SET character_name=excluded.character_name, status='pending',
          revision=revision+1, applied_at=excluded.applied_at, reviewed_at=NULL, reviewed_by=NULL`).run(userId, characterName, timestamp);
        issue(userId, timestamp);
        return state(userId, timestamp);
      });
    },
    renewVerification(userId, revision, timestamp) {
      return transaction(() => {
        if (!active(userId)) forbidden();
        if (targetRevision(userId, revision).status !== 'pending') conflict();
        const previous = challenge(userId);
        if (previous && timestamp < previous.issued_at + 60000) throw new GuildError(429, 'verification_cooldown');
        issue(userId, timestamp);
        db.prepare('UPDATE guild_memberships SET revision=revision+1 WHERE user_id=?').run(userId);
        return state(userId, timestamp);
      });
    },
    review(actorId, targetId, status, revision, timestamp, proof = {}) {
      const outcome = transaction(() => {
        const actorRole = requireStaff(actorId);
        const targetRole = role(targetId);
        if (actorId === targetId || targetRole === 'owner' || (actorRole !== 'owner' && targetRole !== 'member')) forbidden();
        const target = targetRevision(targetId, revision);
        if (!((target.status === 'pending' && ['approved', 'rejected'].includes(status)) || (target.status === 'approved' && status === 'revoked'))) conflict();
        if (status === 'approved') {
          if (proof.verifiedInGame !== true || typeof proof.verificationCode !== 'string' || !/^\d{8}$/.test(proof.verificationCode)) throw new GuildError(400, 'invalid_request');
          const expected = challenge(targetId);
          if (!expected) throw new GuildError(409, 'verification_required');
          if (expected.expires_at <= timestamp) throw new GuildError(409, 'verification_expired');
          if (expected.attempts >= 5) throw new GuildError(429, 'verification_locked');
          if (!timingSafeEqual(Buffer.from(expected.code), Buffer.from(proof.verificationCode))) {
            db.prepare('UPDATE guild_verifications SET attempts=attempts+1 WHERE user_id=?').run(targetId);
            return new GuildError(expected.attempts === 4 ? 429 : 400, expected.attempts === 4 ? 'verification_locked' : 'verification_invalid');
          }
          if (db.prepare("SELECT 1 FROM guild_memberships WHERE lower(character_name)=lower(?) AND status='approved' AND user_id<>?").get(target.characterName, targetId)) {
            throw new GuildError(409, 'character_already_verified');
          }
        }
        db.prepare('UPDATE guild_memberships SET status=?, revision=revision+1, reviewed_at=?, reviewed_by=? WHERE user_id=?').run(status, timestamp, actorId, targetId);
        db.prepare('DELETE FROM guild_verifications WHERE user_id=?').run(targetId);
        if (status === 'revoked') db.prepare('DELETE FROM guild_roles WHERE user_id=?').run(targetId);
      });
      if (outcome instanceof GuildError) throw outcome;
    },
    setRole(actorId, targetId, newRole, revision, timestamp) {
      return transaction(() => {
        requireStaff(actorId, true);
        if (actorId === targetId || role(targetId) === 'owner') forbidden();
        if (!['member', 'admin'].includes(newRole)) throw new GuildError(400, 'invalid_request');
        const target = targetRevision(targetId, revision);
        if (target.status !== 'approved' || role(targetId) === newRole) conflict();
        if (newRole === 'admin') db.prepare("INSERT INTO guild_roles VALUES (?, 'admin', ?)").run(targetId, timestamp);
        else db.prepare('DELETE FROM guild_roles WHERE user_id=?').run(targetId);
        db.prepare('UPDATE guild_memberships SET revision=revision+1 WHERE user_id=?').run(targetId);
      });
    },
    members(actorId, { status = '', cursor = '' } = {}) {
      requireStaff(actorId);
      const items = db.prepare(`SELECT u.id AS userId, u.provider, u.display_name AS displayName,
        COALESCE(r.role, 'member') AS role, m.character_name AS characterName, m.status, m.revision,
        m.applied_at AS appliedAt, m.reviewed_at AS reviewedAt
        FROM guild_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN guild_roles r ON r.user_id=u.id
        WHERE u.id>? AND (?='' OR m.status=?)
        AND NOT EXISTS (SELECT 1 FROM deletion_intents WHERE user_id=u.id)
        ORDER BY u.id LIMIT 26`).all(cursor, status, status);
      const nextCursor = items.length > 25 ? items[24].userId : null;
      return { items: items.slice(0, 25), nextCursor };
    },
  };
}
