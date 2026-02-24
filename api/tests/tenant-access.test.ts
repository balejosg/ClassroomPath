import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { TRPCError } from '@trpc/server';
import { eq, inArray } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  assertCanUseGroup,
  assertCanViewGroup,
  assertOrgGroupAccess,
  getAccessibleTenantGroupIds,
  getTeacherGroupIdentifiers,
  requireTeacherOrAdmin,
  teacherCanUseGroup,
} from '../src/lib/tenant-access.js';

function assertTrpcError(err: unknown, expectedCode: string, expectedMessage?: string): void {
  assert.ok(err instanceof TRPCError);
  assert.strictEqual(err.code, expectedCode);
  if (expectedMessage !== undefined) {
    assert.strictEqual(err.message, expectedMessage);
  }
}

const RUN_ID = Math.random().toString(36).slice(2, 10);

const USER_ID = `tacc_u_${RUN_ID}`;
const USER_EMAIL = `tacc-${RUN_ID}@test.local`;

const ORG_ID = `org_tacc_${RUN_ID}`;

const GROUP_ID = `tacc_g_${RUN_ID}_1`;
const GROUP_NAME = `tacc_group_${RUN_ID}_name_1`;

const GROUP_ID_2 = `tacc_g_${RUN_ID}_2`;
const GROUP_NAME_2 = `tacc_group_${RUN_ID}_name_2`;

const GROUP_ID_3 = `tacc_g_${RUN_ID}_3`;
const GROUP_NAME_3 = `tacc_group_${RUN_ID}_name_3`;

describe('tenant-access', () => {
  before(async () => {
    // Best-effort cleanup in case a previous run failed mid-hook.
    await db
      .delete(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb.delete(openpathSchema.roles).where(eq(openpathSchema.roles.userId, USER_ID));
    await openpathDb
      .delete(openpathSchema.whitelistGroups)
      .where(inArray(openpathSchema.whitelistGroups.id, [GROUP_ID, GROUP_ID_2, GROUP_ID_3]));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, USER_ID));

    // OpenPath user (roles table may have FK to users)
    await openpathDb.insert(openpathSchema.users).values({
      id: USER_ID,
      email: USER_EMAIL,
      name: 'Tenant Access Test User',
      passwordHash: 'hashed_password_placeholder',
      isActive: true,
      emailVerified: false,
    });

    await openpathDb.insert(openpathSchema.whitelistGroups).values([
      {
        id: GROUP_ID,
        name: GROUP_NAME,
        displayName: 'Group 1',
        enabled: 1,
      },
      {
        id: GROUP_ID_2,
        name: GROUP_NAME_2,
        displayName: 'Group 2',
        enabled: 1,
      },
      {
        id: GROUP_ID_3,
        name: GROUP_NAME_3,
        displayName: 'Group 3',
        enabled: 1,
      },
    ]);

    // Teacher owns GROUP_ID by id and GROUP_ID_2 by name (legacy support)
    // NOTE: OpenPath DB enforces a single roles row per user (roles_user_id_key).
    await openpathDb.insert(openpathSchema.roles).values({
      id: `role_t_${RUN_ID}`,
      userId: USER_ID,
      role: 'teacher',
      groupIds: [GROUP_ID, `  ${GROUP_NAME_2}  `],
      createdBy: USER_ID,
    });

    // ClassroomPath org + org group links
    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Tenant Access Org ${RUN_ID}`,
      createdBy: USER_ID,
    });

    await db.insert(schema.cpOrganizationGroups).values([
      { id: `og_${RUN_ID}_1`, organizationId: ORG_ID, groupId: GROUP_ID },
      { id: `og_${RUN_ID}_2`, organizationId: ORG_ID, groupId: GROUP_ID_2 },
      {
        id: `og_${RUN_ID}_3`,
        organizationId: ORG_ID,
        groupId: GROUP_ID_3,
        visibility: 'instance_public',
      },
    ]);
  });

  after(async () => {
    await db
      .delete(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));

    await openpathDb.delete(openpathSchema.roles).where(eq(openpathSchema.roles.userId, USER_ID));
    await openpathDb
      .delete(openpathSchema.whitelistGroups)
      .where(inArray(openpathSchema.whitelistGroups.id, [GROUP_ID, GROUP_ID_2, GROUP_ID_3]));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, USER_ID));
  });

  it('requireTeacherOrAdmin allows admin/teacher and rejects others', () => {
    requireTeacherOrAdmin({ userRole: 'admin' });
    requireTeacherOrAdmin({ userRole: 'teacher' });

    try {
      requireTeacherOrAdmin({ userRole: 'user' });
      assert.fail('expected requireTeacherOrAdmin to throw');
    } catch (err) {
      assertTrpcError(err, 'FORBIDDEN', 'Teacher access required');
    }
  });

  it('getTeacherGroupIdentifiers returns trimmed identifiers for teacher role', async () => {
    const identifiers = await getTeacherGroupIdentifiers(USER_ID);

    assert.ok(identifiers.has(GROUP_ID));
    assert.ok(identifiers.has(GROUP_NAME_2));
    assert.ok(!identifiers.has(`  ${GROUP_NAME_2}  `));
  });

  it('teacherCanUseGroup supports id and name fallback', async () => {
    assert.strictEqual(
      await teacherCanUseGroup({ userId: USER_ID, groupId: GROUP_ID }),
      true,
      'teacher should be able to use owned group id'
    );

    assert.strictEqual(
      await teacherCanUseGroup({ userId: USER_ID, groupId: GROUP_ID_2 }),
      true,
      'teacher should be able to use group via legacy name ownership'
    );
  });

  it('assertCanUseGroup enforces teacher ownership and allows admin', async () => {
    await assertCanUseGroup({ userRole: 'admin', user: { sub: USER_ID } }, 'nonexistent');

    await assertCanUseGroup({ userRole: 'teacher', user: { sub: USER_ID } }, GROUP_ID);

    try {
      await assertCanUseGroup({ userRole: 'teacher', user: { sub: USER_ID } }, 'not-owned-group', {
        notAllowedMessage: 'NO',
      });
      assert.fail('expected assertCanUseGroup to throw');
    } catch (err) {
      assertTrpcError(err, 'FORBIDDEN', 'NO');
    }
  });

  it('assertOrgGroupAccess enforces org membership', async () => {
    await assertOrgGroupAccess(ORG_ID, GROUP_ID);

    try {
      await assertOrgGroupAccess(ORG_ID, 'missing');
      assert.fail('expected assertOrgGroupAccess to throw');
    } catch (err) {
      assertTrpcError(err, 'NOT_FOUND', 'Group not found or access denied');
    }
  });

  it('assertCanViewGroup allows teacher to view instance_public org groups', async () => {
    await assertCanViewGroup(
      { organizationId: ORG_ID, userRole: 'teacher', user: { sub: USER_ID } },
      GROUP_ID_3
    );
  });

  it('getAccessibleTenantGroupIds filters teacher groups by ownership', async () => {
    const adminIds = await getAccessibleTenantGroupIds({
      organizationId: ORG_ID,
      userRole: 'admin',
      userId: USER_ID,
    });
    assert.deepStrictEqual([...adminIds].sort(), [GROUP_ID, GROUP_ID_2, GROUP_ID_3].sort());

    const teacherIds = await getAccessibleTenantGroupIds({
      organizationId: ORG_ID,
      userRole: 'teacher',
      userId: USER_ID,
    });
    assert.deepStrictEqual([...teacherIds].sort(), [GROUP_ID, GROUP_ID_2].sort());

    const userIds = await getAccessibleTenantGroupIds({
      organizationId: ORG_ID,
      userRole: 'user',
      userId: USER_ID,
    });
    assert.deepStrictEqual(userIds, []);
  });
});
