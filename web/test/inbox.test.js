import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createUnlinkInbox } from '../src/inbox.js';

test('inbox restart removes unacknowledged temporary files and preserves durable events', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'web-unlink-inbox-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const userId = '3456789012';
  const name = `kakao-${createHash('sha256').update(userId).digest('hex')}.json`;
  const temporary = `${name}.${'a'.repeat(24)}.tmp`;
  const inbox = createUnlinkInbox(directory);
  inbox.enqueue(userId);
  await writeFile(join(directory, temporary), '{"userId":', { mode: 0o600 });
  const reopened = createUnlinkInbox(directory);
  assert.deepEqual(await readdir(directory), [name]);
  assert.deepEqual(reopened.pending(), [userId]);
  reopened.enqueue(userId);
  assert.deepEqual(await readdir(directory), [name]);
  reopened.remove(userId);
  assert.deepEqual(await readdir(directory), []);
});
