import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { openpathDb, roles, users, whitelistGroups } from '../src/db/openpath.js';
import {
  getOrganizationGroupById,
  getOrganizationGroupByName,
} from '../src/services/group-read-lookup.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
let counter = 0;
const organizationIds = new Set<string>();
const membershipIds = new Set<string>();
const userIds = new Set<string>();
const roleIds = new Set<string>();
const groupIds = new Set<string>();
const orgGroupIds = new Set<string>();

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${RUN_ID}_${String(counter)}`;
}

async function seedOrganization(createdBy: string): Promise<string> {
  const organizationId = nextId('org');
  organizationIds.add(organizationId);
  await db.insert(schema.cpOrganizations).values({
    id: organizationId,
    name: `Org ${organizationId}`,
    createdBy,
  });
  return organizationId;
}

async function seedMembership(params: {
  organizationId: string;
  userId: string;
  role: 'admin' | 'teacher';
}) {
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

async function seedOpenPathUser(userId: string) {
  userIds.add(userId);
  await openpathDb.insert(users).values({
    id: userId,
    email: `${userId}@example.com`,
    name: `User ${userId}`,
    passwordHash: 'hash',
    isActive: true,
  });
}

async function seedOrganizationGroup(params: {
  organizationId: string;
  openpathName: string;
  publicName: string | null;
}) {
  const groupId = nextId('grp');
  const orgGroupId = nextId('orggrp');
  groupIds.add(groupId);
  orgGroupIds.add(orgGroupId);

  await openpathDb.insert(whitelistGroups).values({
    id: groupId,
    name: params.openpathName,
    displayName: `Display ${params.openpathName}`,
    enabled: 1,
  });

  await db.insert(schema.cpOrganizationGroups).values({
    id: orgGroupId,
    organizationId: params.organizationId,
    groupId,
    publicName: params.publicName,
    visibility: 'private',
  });

  return groupId;
}

async function seedTeacherRole(userId: string, assignedGroupIds: string[]) {
  const roleId = nextId('role');
  roleIds.add(roleId);
  await openpathDb.insert(roles).values({
    id: roleId,
    userId,
    role: 'teacher',
    groupIds: assignedGroupIds,
    createdBy: userId,
  });
}

after(async () => {
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

void describe('group-read-lookup.service', { concurrency: 1 }, () => {
  void test('looks up an organization group by id and preserves the public name', async () => {
    const organizationId = await seedOrganization('creator_lookup_by_id');
    const groupId = await seedOrganizationGroup({
      organizationId,
      openpathName: nextId('openpath_by_id'),
      publicName: 'public-lookup-name',
    });

    const result = await getOrganizationGroupById({ organizationId, groupId });

    assert.ok(result);
    assert.equal(result.id, groupId);
    assert.equal(result.name, 'public-lookup-name');
  });

  void test('resolves a legacy OpenPath group by name for an assigned teacher', async () => {
    const userId = nextId('teacher_lookup');
    const organizationId = await seedOrganization(userId);
    await seedMembership({ organizationId, userId, role: 'teacher' });
    await seedOpenPathUser(userId);
    const legacyOpenpathName = `legacy-group-${nextId('slug')}`;
    const groupId = await seedOrganizationGroup({
      organizationId,
      openpathName: legacyOpenpathName,
      publicName: 'mapped-legacy-group',
    });
    await seedTeacherRole(userId, [groupId]);

    const result = await getOrganizationGroupByName({
      organizationId,
      userId,
      userRole: 'teacher',
      name: legacyOpenpathName,
    });

    assert.ok(result);
    assert.equal(result.id, groupId);
    assert.equal(result.name, 'mapped-legacy-group');
  });

  void test('hides legacy groups from teachers without access and returns null when missing', async () => {
    const userId = nextId('teacher_hidden');
    const organizationId = await seedOrganization(userId);
    await seedMembership({ organizationId, userId, role: 'teacher' });
    await seedOpenPathUser(userId);
    const hiddenOpenpathName = `hidden-group-${nextId('slug')}`;
    await seedOrganizationGroup({
      organizationId,
      openpathName: hiddenOpenpathName,
      publicName: 'hidden-public-group',
    });
    await seedTeacherRole(userId, []);

    const hiddenResult = await getOrganizationGroupByName({
      organizationId,
      userId,
      userRole: 'teacher',
      name: hiddenOpenpathName,
    });
    const missingResult = await getOrganizationGroupByName({
      organizationId,
      userId,
      userRole: 'admin',
      name: `missing-${nextId('group')}`,
    });

    assert.equal(hiddenResult, null);
    assert.equal(missingResult, null);
  });
});
