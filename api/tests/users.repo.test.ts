import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { inArray } from 'drizzle-orm';

import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { findUserIdById, getUserById } from '../src/db/openpath-repos/users.repo.js';

// Self-contained 1:1 gate-named coverage for users.repo.ts. Pins the read
// projections folded from the old lib/openpath-users.ts helpers (plan Task 9):
// getUserById returns exactly {id,email,name}; findUserIdById returns the id or
// undefined for a missing user. Mirrors the users assertions co-located in
// roles.repo.test.ts, with its own seed/cleanup.

const RUN_ID = Math.random().toString(36).slice(2, 10);
const userIds = new Set<string>();

async function seedUser(suffix: string): Promise<string> {
  const id = `urepo_${RUN_ID}_${suffix}`;
  userIds.add(id);
  await openpathDb.insert(openpathSchema.users).values({
    id,
    email: `urepo-${RUN_ID}-${suffix}@test.local`,
    name: `Users Repo ${suffix}`,
    passwordHash: 'hashed',
    isActive: true,
    emailVerified: true,
  });
  return id;
}

after(async () => {
  const ids = [...userIds];
  if (ids.length === 0) return;
  await openpathDb.delete(openpathSchema.users).where(inArray(openpathSchema.users.id, ids));
});

describe('users.repo (1:1 named)', () => {
  it('getUserById projects {id,email,name}; findUserIdById returns the id or undefined', async () => {
    const userId = await seedUser('reader');
    const user = await getUserById(userId);
    assert.deepEqual(user, {
      id: userId,
      email: `urepo-${RUN_ID}-reader@test.local`,
      name: 'Users Repo reader',
    });
    assert.equal(await findUserIdById(userId), userId);
    assert.equal(await findUserIdById(`missing_${RUN_ID}`), undefined);
  });
});
