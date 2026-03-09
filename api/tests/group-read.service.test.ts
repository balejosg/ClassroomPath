import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import { inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { openpathDb, roles, users, whitelistGroups, whitelistRules } from '../src/db/openpath.js';
import {
  getOrganizationGroupByName,
  getOrganizationSystemStatus,
  listOrganizationGroups,
  listOrganizationLibraryGroups,
} from '../src/services/group-read.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
let counter = 0;
const organizationIds = new Set<string>();
const membershipIds = new Set<string>();
const userIds = new Set<string>();
const roleIds = new Set<string>();
const groupIds = new Set<string>();
const orgGroupIds = new Set<string>();
const ruleIds = new Set<string>();

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
  userIds.add(params.userId);

  await db.insert(schema.cpMemberships).values({
    id: membershipId,
    organizationId: params.organizationId,
    userId: params.userId,
    role: params.role,
    invitedBy: params.userId,
  });
}

async function seedOpenPathUser(params: { userId: string; email: string; name: string }) {
  await openpathDb.insert(users).values({
    id: params.userId,
    email: params.email,
    name: params.name,
    passwordHash: 'hashed-password',
    isActive: true,
  });
}

async function seedOrganizationGroup(params: {
  organizationId: string;
  publicName: string;
  displayName: string;
  visibility?: 'private' | 'instance_public';
  enabled?: number;
}): Promise<string> {
  const groupId = nextId('grp');
  const orgGroupId = nextId('orggrp');
  groupIds.add(groupId);
  orgGroupIds.add(orgGroupId);

  await openpathDb.insert(whitelistGroups).values({
    id: groupId,
    name: `${params.organizationId}-${params.publicName}`.slice(0, 100),
    displayName: params.displayName,
    enabled: params.enabled ?? 1,
  });

  await db.insert(schema.cpOrganizationGroups).values({
    id: orgGroupId,
    organizationId: params.organizationId,
    groupId,
    publicName: params.publicName,
    visibility: params.visibility ?? 'private',
  });

  return groupId;
}

async function seedRule(params: {
  groupId: string;
  type: 'whitelist' | 'blocked_subdomain' | 'blocked_path';
  value: string;
}): Promise<void> {
  const ruleId = nextId('rule');
  ruleIds.add(ruleId);

  await openpathDb.insert(whitelistRules).values({
    id: ruleId,
    groupId: params.groupId,
    type: params.type,
    value: params.value,
  });
}

async function seedTeacherRole(params: { userId: string; groupIds: string[] }) {
  const roleId = nextId('role');
  roleIds.add(roleId);

  await openpathDb.insert(roles).values({
    id: roleId,
    userId: params.userId,
    role: 'teacher',
    groupIds: params.groupIds,
    createdBy: params.userId,
  });
}

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
});

describe('group-read.service', () => {
  it('filters teacher-visible groups and derives rule counts', async () => {
    const teacherUserId = nextId('teacher');
    const organizationId = await seedOrganization('Teacher Groups', teacherUserId);
    await seedMembership({ organizationId, userId: teacherUserId, role: 'teacher' });
    await seedOpenPathUser({
      userId: teacherUserId,
      email: `${teacherUserId}@example.com`,
      name: 'Teacher User',
    });

    const visibleGroupId = await seedOrganizationGroup({
      organizationId,
      publicName: 'math-club',
      displayName: 'Math Club',
      enabled: 1,
    });
    const hiddenGroupId = await seedOrganizationGroup({
      organizationId,
      publicName: 'science-club',
      displayName: 'Science Club',
      enabled: 0,
    });

    await seedRule({ groupId: visibleGroupId, type: 'whitelist', value: 'allowed.test' });
    await seedRule({ groupId: visibleGroupId, type: 'blocked_path', value: 'blocked.test/path' });
    await seedRule({ groupId: hiddenGroupId, type: 'blocked_subdomain', value: 'hidden.test' });
    await seedTeacherRole({ userId: teacherUserId, groupIds: [visibleGroupId] });

    const groups = await listOrganizationGroups({
      organizationId,
      userId: teacherUserId,
      userRole: 'teacher',
    });
    const status = await getOrganizationSystemStatus({
      organizationId,
      userId: teacherUserId,
      userRole: 'teacher',
    });

    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0]?.id, visibleGroupId);
    assert.strictEqual(groups[0]?.name, 'math-club');
    assert.strictEqual(groups[0]?.whitelistCount, 1);
    assert.strictEqual(groups[0]?.blockedPathCount, 1);
    assert.strictEqual(groups[0]?.blockedSubdomainCount, 0);

    assert.deepStrictEqual(status, {
      enabled: true,
      totalGroups: 1,
      activeGroups: 1,
      pausedGroups: 0,
      enabledGroups: 1,
      disabledGroups: 0,
    });
  });

  it('lists library groups and resolves lookups by organization public name', async () => {
    const adminUserId = nextId('admin');
    const organizationId = await seedOrganization('Library Groups', adminUserId);
    await seedMembership({ organizationId, userId: adminUserId, role: 'admin' });
    await seedOpenPathUser({
      userId: adminUserId,
      email: `${adminUserId}@example.com`,
      name: 'Admin User',
    });

    const libraryGroupId = await seedOrganizationGroup({
      organizationId,
      publicName: 'shared-library',
      displayName: 'Shared Library',
      visibility: 'instance_public',
    });
    await seedOrganizationGroup({
      organizationId,
      publicName: 'private-library',
      displayName: 'Private Library',
      visibility: 'private',
    });

    const libraryGroups = await listOrganizationLibraryGroups(organizationId);
    const byName = await getOrganizationGroupByName({
      organizationId,
      userId: adminUserId,
      userRole: 'admin',
      name: 'shared-library',
    });

    assert.strictEqual(libraryGroups.length, 1);
    assert.strictEqual(libraryGroups[0]?.id, libraryGroupId);
    assert.strictEqual(libraryGroups[0]?.visibility, 'instance_public');
    assert.ok(byName);
    assert.strictEqual(byName?.id, libraryGroupId);
    assert.strictEqual(byName?.name, 'shared-library');
  });
});
