import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import {
  acquireIntegrationSuiteLock,
  DEFAULT_INTEGRATION_SUITE_LOCK_PATH,
  releaseIntegrationSuiteLock,
} from '@classroompath/testkit';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { openpathDb, roles, users, whitelistGroups, whitelistRules } from '../src/db/openpath.js';
import {
  addGroupToTeacherRole,
  bulkDeleteOrganizationGroupRules,
  createOrganizationGroup,
  createOrganizationGroupFromRules,
  deleteOrganizationGroup,
  removeGroupFromTeacherRole,
  updateOrganizationGroup,
} from '../src/services/group-write.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
let counter = 0;
const organizationIds = new Set<string>();
const membershipIds = new Set<string>();
const roleIds = new Set<string>();
const groupIds = new Set<string>();
const orgGroupIds = new Set<string>();
const ruleIds = new Set<string>();
const userIds = new Set<string>();
let integrationSuiteLock: Awaited<ReturnType<typeof acquireIntegrationSuiteLock>> | undefined;

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

before(async () => {
  integrationSuiteLock = await acquireIntegrationSuiteLock();
});

after(async () => {
  if (ruleIds.size > 0) {
    await openpathDb.delete(whitelistRules).where(inArray(whitelistRules.id, [...ruleIds]));
  }

  if (roleIds.size > 0) {
    await openpathDb.delete(roles).where(inArray(roles.id, [...roleIds]));
  }

  if (userIds.size > 0) {
    await openpathDb.delete(users).where(inArray(users.id, [...userIds]));
  }

  if (orgGroupIds.size > 0) {
    await db
      .delete(schema.cpOrganizationGroups)
      .where(inArray(schema.cpOrganizationGroups.id, [...orgGroupIds]));
  }

  if (groupIds.size > 0) {
    await openpathDb.delete(whitelistGroups).where(inArray(whitelistGroups.id, [...groupIds]));
  }

  if (membershipIds.size > 0) {
    await db
      .delete(schema.cpMemberships)
      .where(inArray(schema.cpMemberships.id, [...membershipIds]));
  }

  if (organizationIds.size > 0) {
    await db
      .delete(schema.cpOrganizations)
      .where(inArray(schema.cpOrganizations.id, [...organizationIds]));
  }

  await releaseIntegrationSuiteLock(integrationSuiteLock, DEFAULT_INTEGRATION_SUITE_LOCK_PATH);
  integrationSuiteLock = undefined;
});

describe('group-write.service', { concurrency: 1 }, () => {
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

  it('creates a presentable organization group through the wrapper', async () => {
    const adminUserId = nextId('admin');
    const organizationId = await seedOrganization('Wrapper Groups', adminUserId);
    await seedMembership({ organizationId, userId: adminUserId, role: 'admin' });
    await seedOpenPathUser({
      userId: adminUserId,
      email: `${adminUserId}@example.com`,
      name: 'Admin Owner',
    });

    const created = await createOrganizationGroup({
      organizationId,
      actorUserId: adminUserId,
      actorRole: 'admin',
      name: 'My First Group',
      displayName: 'My First Group',
      enabled: 1,
    });

    groupIds.add(created.id);

    const [orgGroup] = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, organizationId),
          eq(schema.cpOrganizationGroups.groupId, created.id)
        )
      )
      .limit(1);

    if (orgGroup) {
      orgGroupIds.add(orgGroup.id);
    }

    const [openPathGroup] = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(eq(whitelistGroups.id, created.id))
      .limit(1);

    assert.strictEqual(created.name, 'my-first-group');
    assert.strictEqual(created.displayName, 'My First Group');
    assert.strictEqual(created.enabled, true);
    assert.ok(orgGroup);
    assert.ok(openPathGroup);
    assert.notStrictEqual(openPathGroup?.name, created.name);
  });

  it('updates, bulk-deletes rules, and deletes tenant-owned groups', async () => {
    const adminUserId = nextId('admin');
    const organizationId = await seedOrganization('Mutable Groups', adminUserId);
    await seedMembership({ organizationId, userId: adminUserId, role: 'admin' });
    await seedOpenPathUser({
      userId: adminUserId,
      email: `${adminUserId}@example.com`,
      name: 'Admin Mutator',
    });

    const created = await createOrganizationGroupFromRules({
      organizationId,
      actorUserId: adminUserId,
      actorRole: 'admin',
      publicName: 'Class Set',
      displayName: 'Class Set',
      visibility: 'private',
      rules: [
        { type: 'whitelist', value: 'allowed.example.com', comment: 'Allow' },
        { type: 'blocked_path', value: 'blocked.example.com/docs', comment: 'Block' },
      ],
    });

    groupIds.add(created.group.id);

    const [orgGroup] = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, organizationId),
          eq(schema.cpOrganizationGroups.groupId, created.group.id)
        )
      )
      .limit(1);

    if (orgGroup) {
      orgGroupIds.add(orgGroup.id);
    }

    const rulesBeforeDelete = await openpathDb
      .select()
      .from(whitelistRules)
      .where(eq(whitelistRules.groupId, created.group.id));
    rulesBeforeDelete.forEach((rule) => ruleIds.add(rule.id));

    const updated = await updateOrganizationGroup({
      organizationId,
      userId: adminUserId,
      userRole: 'admin',
      groupId: created.group.id,
      displayName: 'Updated Class Set',
      enabled: true,
      visibility: 'instance_public',
    });

    assert.strictEqual(updated.displayName, 'Updated Class Set');
    assert.strictEqual(updated.enabled, true);
    assert.strictEqual(updated.name, 'class-set');

    const deletedRules = await bulkDeleteOrganizationGroupRules({
      organizationId,
      userId: adminUserId,
      userRole: 'admin',
      ids: rulesBeforeDelete.map((rule) => rule.id),
    });

    assert.strictEqual(deletedRules.deleted, 2);
    assert.strictEqual(deletedRules.rules.length, 2);

    const deletedGroup = await deleteOrganizationGroup({
      organizationId,
      userId: adminUserId,
      userRole: 'admin',
      groupId: created.group.id,
    });

    const [remainingOrgGroup] = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, organizationId),
          eq(schema.cpOrganizationGroups.groupId, created.group.id)
        )
      )
      .limit(1);
    const [remainingGroup] = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(eq(whitelistGroups.id, created.group.id))
      .limit(1);

    assert.deepStrictEqual(deletedGroup, { success: true });
    assert.strictEqual(remainingOrgGroup, undefined);
    assert.strictEqual(remainingGroup, undefined);
  });
});
