import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { openpathDb, roles, users, whitelistGroups } from '../src/db/openpath.js';
import {
  addGroupToTeacherRole,
  removeGroupFromTeacherRole,
} from '../src/services/group-role-membership.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
let counter = 0;
const roleIds = new Set<string>();
const groupIds = new Set<string>();
const userIds = new Set<string>();

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${RUN_ID}_${String(counter)}`;
}

async function seedOpenPathUser(params: { userId: string; email: string; name: string }) {
  userIds.add(params.userId);
  await openpathDb.insert(users).values({
    id: params.userId,
    email: params.email,
    name: params.name,
    passwordHash: 'hashed-password',
    isActive: true,
  });
}

after(async () => {
  if (roleIds.size > 0) {
    await openpathDb.delete(roles).where(inArray(roles.id, [...roleIds]));
  }

  if (groupIds.size > 0) {
    await openpathDb.delete(whitelistGroups).where(inArray(whitelistGroups.id, [...groupIds]));
  }

  if (userIds.size > 0) {
    await openpathDb.delete(users).where(inArray(users.id, [...userIds]));
  }
});

describe('group-role-membership.service', () => {
  it('adds and removes teacher group ownership from the mirrored role', async () => {
    const teacherUserId = nextId('teacher');
    const firstGroupId = nextId('grp');
    const secondGroupId = nextId('grp');
    groupIds.add(firstGroupId);
    groupIds.add(secondGroupId);

    await seedOpenPathUser({
      userId: teacherUserId,
      email: `${teacherUserId}@example.com`,
      name: 'Teacher Owner',
    });

    await openpathDb.insert(whitelistGroups).values([
      {
        id: firstGroupId,
        name: `teacher-first-${RUN_ID}`.slice(0, 100),
        displayName: 'Teacher First',
        enabled: 1,
      },
      {
        id: secondGroupId,
        name: `teacher-second-${RUN_ID}`.slice(0, 100),
        displayName: 'Teacher Second',
        enabled: 1,
      },
    ]);

    await addGroupToTeacherRole({
      userId: teacherUserId,
      groupId: firstGroupId,
      createdBy: teacherUserId,
    });
    await addGroupToTeacherRole({
      userId: teacherUserId,
      groupId: secondGroupId,
      createdBy: teacherUserId,
    });

    const [role] = await openpathDb
      .select()
      .from(roles)
      .where(eq(roles.userId, teacherUserId))
      .limit(1);
    if (role) {
      roleIds.add(role.id);
    }

    assert.ok(role);
    assert.deepStrictEqual(role?.groupIds, [firstGroupId, secondGroupId]);

    await removeGroupFromTeacherRole({ userId: teacherUserId, groupId: firstGroupId });

    const [updated] = await openpathDb
      .select()
      .from(roles)
      .where(eq(roles.userId, teacherUserId))
      .limit(1);

    assert.deepStrictEqual(updated?.groupIds, [secondGroupId]);
  });
});
