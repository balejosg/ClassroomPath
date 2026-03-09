import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import { and, eq, inArray, or } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { openpathDb, roles, users, whitelistGroups } from '../src/db/openpath.js';
import {
  assignOrganizationUserRole,
  createOrganizationUser,
  deleteOrganizationUser,
  getOrganizationUserById,
  getOrganizationUserRole,
  listOrganizationUsers,
  revokeOrganizationUserRole,
  updateOrganizationUser,
} from '../src/services/user.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
let counter = 0;
const organizationIds = new Set<string>();
const membershipIds = new Set<string>();
const legacyOrgUserIds = new Set<string>();
const userIds = new Set<string>();
const roleIds = new Set<string>();
const groupIds = new Set<string>();

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${RUN_ID}_${String(counter)}`;
}

async function seedOrganization(name: string, createdBy: string): Promise<string> {
  const organizationId = nextId('org');
  organizationIds.add(organizationId);
  await db.insert(schema.cpOrganizations).values({
    id: organizationId,
    name,
    createdBy,
  });
  return organizationId;
}

async function seedMembership(params: {
  organizationId: string;
  userId: string;
  role: 'admin' | 'teacher';
}): Promise<void> {
  const membershipId = nextId('mem');
  membershipIds.add(membershipId);

  await db.insert(schema.cpMemberships).values({
    id: membershipId,
    organizationId: params.organizationId,
    userId: params.userId,
    role: params.role,
    invitedBy: params.userId,
  });
}

async function seedUser(params: {
  userId: string;
  email: string;
  name: string;
  passwordHash?: string;
}) {
  userIds.add(params.userId);
  await openpathDb.insert(users).values({
    id: params.userId,
    email: params.email,
    name: params.name,
    passwordHash: params.passwordHash ?? 'hashed-password',
    isActive: true,
  });
}

after(async () => {
  const trackedUserIds = [...userIds];

  if (legacyOrgUserIds.size > 0) {
    await db
      .delete(schema.cpOrganizationUsers)
      .where(inArray(schema.cpOrganizationUsers.id, [...legacyOrgUserIds]));
  }

  if (trackedUserIds.length > 0 || roleIds.size > 0) {
    const conditions = [];
    if (roleIds.size > 0) {
      conditions.push(inArray(roles.id, [...roleIds]));
    }
    if (trackedUserIds.length > 0) {
      conditions.push(inArray(roles.userId, trackedUserIds));
      conditions.push(inArray(roles.createdBy, trackedUserIds));
    }

    await openpathDb.delete(roles).where(or(...conditions)!);
  }

  if (userIds.size > 0) {
    await openpathDb.delete(users).where(inArray(users.id, [...userIds]));
  }

  if (membershipIds.size > 0) {
    await db
      .delete(schema.cpMemberships)
      .where(inArray(schema.cpMemberships.id, [...membershipIds]));
  }

  if (groupIds.size > 0) {
    await openpathDb.delete(whitelistGroups).where(inArray(whitelistGroups.id, [...groupIds]));
  }

  if (organizationIds.size > 0) {
    await db
      .delete(schema.cpOrganizations)
      .where(inArray(schema.cpOrganizations.id, [...organizationIds]));
  }
});

describe('user.service', () => {
  it('creates users and returns organization-scoped listings', async () => {
    const adminUserId = nextId('admin');
    const organizationId = await seedOrganization('User Service Org', adminUserId);
    await seedMembership({ organizationId, userId: adminUserId, role: 'admin' });
    await seedUser({
      userId: adminUserId,
      email: `${adminUserId}@example.com`,
      name: 'Admin Creator',
    });

    const created = await createOrganizationUser({
      organizationId,
      actedBy: adminUserId,
      email: `teacher-${RUN_ID}@example.com`,
      name: 'Teacher Example',
      password: 'TeacherPassword123!',
      role: 'teacher',
    });
    userIds.add(created.id);

    const listed = await listOrganizationUsers(organizationId);
    const fetched = await getOrganizationUserById({
      organizationId,
      userId: created.id,
    });

    assert.strictEqual(created.email, `teacher-${RUN_ID}@example.com`);
    assert.strictEqual(created.roles[0]?.role, 'teacher');
    assert.strictEqual(
      listed.some((user) => user.id === created.id),
      true
    );
    assert.strictEqual(fetched?.id, created.id);
    assert.strictEqual(fetched?.roles[0]?.role, 'teacher');
  });

  it('updates, reassigns, revokes, and deletes organization users', async () => {
    const adminUserId = nextId('admin');
    const targetUserId = nextId('user');
    const groupId = nextId('grp');
    const organizationId = await seedOrganization('Mutable Users Org', adminUserId);
    groupIds.add(groupId);

    await seedMembership({ organizationId, userId: adminUserId, role: 'admin' });
    await seedMembership({ organizationId, userId: targetUserId, role: 'teacher' });
    await seedUser({
      userId: adminUserId,
      email: `${adminUserId}@example.com`,
      name: 'Admin Manager',
    });
    await seedUser({
      userId: targetUserId,
      email: `mutable-${RUN_ID}@example.com`,
      name: 'Mutable User',
    });
    await openpathDb.insert(whitelistGroups).values({
      id: groupId,
      name: `mutable-group-${RUN_ID}`.slice(0, 100),
      displayName: 'Mutable Group',
      enabled: 1,
    });

    const initialRoleId = nextId('role');
    roleIds.add(initialRoleId);
    await openpathDb.insert(roles).values({
      id: initialRoleId,
      userId: targetUserId,
      role: 'teacher',
      groupIds: [],
      createdBy: adminUserId,
    });

    const legacyOrgUserId = nextId('legacy');
    legacyOrgUserIds.add(legacyOrgUserId);
    await db.insert(schema.cpOrganizationUsers).values({
      id: legacyOrgUserId,
      organizationId,
      openpathUserId: targetUserId,
    });

    const updatedUser = await updateOrganizationUser({
      organizationId,
      userId: targetUserId,
      name: 'Updated User',
      active: false,
    });
    const assignedRole = await assignOrganizationUserRole({
      organizationId,
      userId: targetUserId,
      actedBy: adminUserId,
      role: 'admin',
      groupIds: [groupId],
    });
    const lookedUpRole = await getOrganizationUserRole({
      organizationId,
      userId: targetUserId,
    });
    const revoked = await revokeOrganizationUserRole({
      organizationId,
      userId: targetUserId,
      actedBy: adminUserId,
    });
    const deleted = await deleteOrganizationUser({
      organizationId,
      userId: targetUserId,
      actedBy: adminUserId,
    });

    const [remainingMembership] = await db
      .select()
      .from(schema.cpMemberships)
      .where(
        and(
          eq(schema.cpMemberships.organizationId, organizationId),
          eq(schema.cpMemberships.userId, targetUserId)
        )
      )
      .limit(1);
    const remainingRoles = await openpathDb
      .select()
      .from(roles)
      .where(eq(roles.userId, targetUserId));

    remainingRoles.forEach((role) => roleIds.add(role.id));

    assert.strictEqual(updatedUser.name, 'Updated User');
    assert.strictEqual(updatedUser.isActive, false);
    assert.strictEqual(assignedRole.role, 'admin');
    assert.deepStrictEqual(assignedRole.groupIds, [groupId]);
    assert.strictEqual(lookedUpRole?.role, 'admin');
    assert.deepStrictEqual(lookedUpRole?.groupIds, [groupId]);
    assert.deepStrictEqual(revoked, { success: true });
    assert.deepStrictEqual(deleted, { success: true });
    assert.strictEqual(remainingMembership, undefined);
    assert.strictEqual(remainingRoles.length, 0);
  });
});
