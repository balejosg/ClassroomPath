import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { inArray } from 'drizzle-orm';

import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  addGroupToTeacherRole,
  getRolesByUserId,
  removeGroupFromTeacherRole,
} from '../src/db/openpath-repos/roles.repo.js';
import { findUserIdById, getUserById } from '../src/db/openpath-repos/users.repo.js';

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
  await openpathDb.delete(openpathSchema.roles).where(inArray(openpathSchema.roles.userId, ids));
  await openpathDb.delete(openpathSchema.users).where(inArray(openpathSchema.users.id, ids));
});

describe('roles.repo + users.repo', () => {
  it('addGroupToTeacherRole creates a teacher role, then merges group ids uniquely', async () => {
    const userId = await seedUser('teacher');
    await addGroupToTeacherRole({ userId, groupId: 'g1', createdBy: userId });
    await addGroupToTeacherRole({ userId, groupId: 'g2', createdBy: userId });
    await addGroupToTeacherRole({ userId, groupId: 'g1', createdBy: userId });

    const rolesAfter = await getRolesByUserId(userId);
    assert.equal(rolesAfter.length, 1);
    assert.deepEqual(rolesAfter[0].groupIds, ['g1', 'g2']);

    await removeGroupFromTeacherRole({ userId, groupId: 'g1' });
    const afterRemove = await getRolesByUserId(userId);
    assert.deepEqual(afterRemove[0].groupIds, ['g2']);
  });

  it('users.repo reads project the same columns as the old lib helpers', async () => {
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
