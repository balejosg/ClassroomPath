/**
 * ClassroomPath users integration tests (/cp/trpc/users.*)
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { and, eq } from 'drizzle-orm';

import {
  trpcMutate,
  trpcQuery,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
} from '../test-utils.js';
import { signToken, useIntegrationServer } from './harness.js';

import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';

const integration = useIntegrationServer({ resetBeforeStart: true });
const LAST_ADMIN_MESSAGE = /last admin|at least one.*admin/i;

async function assertLastAdminConflict(response: Response): Promise<void> {
  assertStatus(response, 409);
  const { code, error } = await parseTRPC(response);
  assert.strictEqual(code, 'CONFLICT');
  assert.match(error ?? '', LAST_ADMIN_MESSAGE);
}

describe('ClassroomPath users integration (/cp/trpc)', { concurrency: 1 }, async () => {
  test('users.list returns SafeUserWithRoles and never exposes passwordHash', async () => {
    const orgId = `org-users-${Date.now()}`;

    const adminUserId = `u-admin-${Date.now()}`;
    const teacherUserId = `u-teacher-${Date.now()}`;

    const adminEmail = uniqueEmail('admin');
    const teacherEmail = uniqueEmail('teacher');

    // Seed OpenPath users
    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: teacherUserId,
        email: teacherEmail,
        name: 'Teacher User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: false,
      },
    ]);

    // Seed OpenPath roles
    await openpathDb.insert(openpathSchema.roles).values([
      {
        id: `role-${adminUserId}`,
        userId: adminUserId,
        role: 'admin',
        groupIds: [],
        createdBy: adminUserId,
      },
      {
        id: `role-${teacherUserId}`,
        userId: teacherUserId,
        role: 'teacher',
        groupIds: [],
        createdBy: adminUserId,
      },
    ]);

    // Seed CP org + memberships
    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values([
      {
        id: `mem-${adminUserId}`,
        userId: adminUserId,
        organizationId: orgId,
        role: 'admin',
        invitedBy: adminUserId,
      },
      {
        id: `mem-${teacherUserId}`,
        userId: teacherUserId,
        organizationId: orgId,
        role: 'teacher',
        invitedBy: adminUserId,
      },
    ]);

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resp = await trpcQuery(integration.baseUrl, 'users.list', undefined, bearerAuth(token));
    assertStatus(resp, 200);

    const { data } = (await parseTRPC(resp)) as { data: any };
    assert.ok(Array.isArray(data), 'users.list must return an array');

    const byEmail = new Map<string, any>(data.map((u: any) => [u.email, u]));
    assert.ok(byEmail.has(adminEmail), 'admin user should be present in users.list');
    assert.ok(byEmail.has(teacherEmail), 'teacher user should be present in users.list');

    for (const u of data as any[]) {
      assert.strictEqual('passwordHash' in u, false, 'passwordHash must never be exposed');
      assert.strictEqual(typeof u.id, 'string');
      assert.strictEqual(typeof u.email, 'string');
      assert.strictEqual(typeof u.name, 'string');
      assert.strictEqual(typeof u.isActive, 'boolean');
      assert.strictEqual(typeof u.createdAt, 'string');
      assert.strictEqual(typeof u.updatedAt, 'string');
      assert.ok(Array.isArray(u.roles), 'roles must be an array');
      for (const r of u.roles) {
        assert.ok(typeof r.role === 'string');
        assert.ok(Array.isArray(r.groupIds));
      }
    }
  });

  test('users.create creates a pending invitation without creating an OpenPath user upfront', async () => {
    const orgId = `org-users-create-${Date.now()}`;

    const adminUserId = `u-admin-create-${Date.now()}`;
    const adminEmail = uniqueEmail('admin-create');

    await openpathDb.insert(openpathSchema.users).values({
      id: adminUserId,
      email: adminEmail,
      name: 'Admin Creator',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${adminUserId}`,
      userId: adminUserId,
      role: 'admin',
      groupIds: [],
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${adminUserId}`,
      userId: adminUserId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: adminUserId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Creator',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const invitedEmail = uniqueEmail('created');
    const createResp = await trpcMutate(
      integration.baseUrl,
      'users.create',
      {
        email: invitedEmail,
        name: 'Created Teacher',
        role: 'teacher',
      },
      bearerAuth(adminToken)
    );
    assertStatus(createResp, 200);

    const { data: invitation } = (await parseTRPC(createResp)) as { data: any };
    assert.strictEqual(invitation.email, invitedEmail);
    assert.strictEqual(invitation.status, 'Pending');
    assert.ok(typeof invitation.id === 'string' && invitation.id.length > 0);
    assert.strictEqual(invitation.emailSent, true);
    assert.strictEqual('invitationUrl' in invitation, false);

    const memberships = await db
      .select()
      .from(cpSchema.cpMemberships)
      .where(eq(cpSchema.cpMemberships.organizationId, orgId));
    assert.strictEqual(
      memberships.length,
      1,
      'only the admin membership should exist before acceptance'
    );

    const orgLinks = await db
      .select()
      .from(cpSchema.cpOrganizationUsers)
      .where(eq(cpSchema.cpOrganizationUsers.organizationId, orgId));
    assert.strictEqual(
      orgLinks.length,
      0,
      'invitation flow should not depend on cp_organization_users for tenant scoping'
    );

    const pendingInvitations = await db
      .select()
      .from(cpSchema.cpInvitations)
      .where(
        and(
          eq(cpSchema.cpInvitations.organizationId, orgId),
          eq(cpSchema.cpInvitations.email, invitedEmail)
        )
      );
    assert.strictEqual(pendingInvitations.length, 1);
    assert.strictEqual(pendingInvitations[0].role, 'teacher');

    const invitedUsers = await openpathDb
      .select()
      .from(openpathSchema.users)
      .where(eq(openpathSchema.users.email, invitedEmail));
    assert.strictEqual(
      invitedUsers.length,
      0,
      'OpenPath user should only be created when the invitee accepts the invitation'
    );
  });

  test('users.create normalizes the invited email before persisting the invitation', async () => {
    const orgId = `org-users-normalize-${Date.now()}`;
    const adminUserId = `u-admin-normalize-${Date.now()}`;
    const adminEmail = uniqueEmail('admin-normalize');

    await openpathDb.insert(openpathSchema.users).values({
      id: adminUserId,
      email: adminEmail,
      name: 'Admin Normalize',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${adminUserId}`,
      userId: adminUserId,
      role: 'admin',
      groupIds: [],
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${adminUserId}`,
      userId: adminUserId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: adminUserId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Normalize',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const createResp = await trpcMutate(
      integration.baseUrl,
      'users.create',
      {
        email: ' MixedCaseUser@Example.COM ',
        name: 'Normalize Invitee',
        role: 'teacher',
      },
      bearerAuth(adminToken)
    );
    assertStatus(createResp, 200);

    const { data: invitation } = (await parseTRPC(createResp)) as {
      data: { email: string };
    };
    assert.strictEqual(invitation.email, 'mixedcaseuser@example.com');

    const persistedInvitations = await db
      .select()
      .from(cpSchema.cpInvitations)
      .where(eq(cpSchema.cpInvitations.organizationId, orgId));
    assert.strictEqual(persistedInvitations.length, 1);
    assert.strictEqual(persistedInvitations[0]?.email, 'mixedcaseuser@example.com');
  });

  test('users.list ignores legacy cp_organization_users rows without a tenant membership', async () => {
    const orgId = `org-users-legacy-link-${Date.now()}`;
    const adminUserId = `u-admin-legacy-link-${Date.now()}`;
    const linkedOnlyUserId = `u-linked-only-${Date.now()}`;

    const adminEmail = uniqueEmail('admin-legacy-link');
    const linkedOnlyEmail = uniqueEmail('linked-only');

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin Legacy Link',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: linkedOnlyUserId,
        email: linkedOnlyEmail,
        name: 'Linked Only User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: false,
      },
    ]);

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${adminUserId}`,
      userId: adminUserId,
      role: 'admin',
      groupIds: [],
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${adminUserId}`,
      userId: adminUserId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizationUsers).values({
      id: `org-user-${linkedOnlyUserId}`,
      organizationId: orgId,
      openpathUserId: linkedOnlyUserId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Legacy Link',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resp = await trpcQuery(
      integration.baseUrl,
      'users.list',
      undefined,
      bearerAuth(adminToken)
    );
    assertStatus(resp, 200);

    const { data } = (await parseTRPC(resp)) as { data: Array<{ id: string }> };
    assert.ok(
      data.every((user) => user.id !== linkedOnlyUserId),
      'legacy cp_organization_users links must not grant tenant visibility without cp_memberships'
    );
  });

  test('users.list is forbidden for non-admin org members', async () => {
    const orgId = `org-users-nonadmin-${Date.now()}`;
    const userId = `u-nonadmin-${Date.now()}`;
    const email = uniqueEmail('nonadmin');

    await openpathDb.insert(openpathSchema.users).values({
      id: userId,
      email,
      name: 'Non Admin',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: false,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: userId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${userId}`,
      userId,
      organizationId: orgId,
      role: 'teacher',
      invitedBy: userId,
    });

    const token = signToken({
      userId,
      email,
      name: 'Non Admin',
      roles: [{ role: 'teacher', groupIds: [] }],
    });

    const resp = await trpcQuery(integration.baseUrl, 'users.list', undefined, bearerAuth(token));
    // tRPC can respond 200 with an error payload; parseTRPC normalizes that.
    const parsed = (await parseTRPC(resp)) as any;
    assert.ok(parsed.error, 'Expected error payload');
    assert.strictEqual(parsed.code, 'FORBIDDEN');
  });

  test('users.delete detaches the tenant user without hard-deleting the global OpenPath identity', async () => {
    const orgId = `org-users-delete-${Date.now()}`;
    const adminUserId = `u-admin-delete-${Date.now()}`;
    const targetUserId = `u-target-delete-${Date.now()}`;

    const adminEmail = uniqueEmail('admin-delete');
    const targetEmail = uniqueEmail('target-delete');

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin Delete',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: targetUserId,
        email: targetEmail,
        name: 'Detach Me',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
    ]);

    await openpathDb.insert(openpathSchema.roles).values([
      {
        id: `role-${adminUserId}`,
        userId: adminUserId,
        role: 'admin',
        groupIds: [],
        createdBy: adminUserId,
      },
      {
        id: `role-${targetUserId}`,
        userId: targetUserId,
        role: 'teacher',
        groupIds: [],
        createdBy: adminUserId,
      },
    ]);

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values([
      {
        id: `mem-${adminUserId}`,
        userId: adminUserId,
        organizationId: orgId,
        role: 'admin',
        invitedBy: adminUserId,
      },
      {
        id: `mem-${targetUserId}`,
        userId: targetUserId,
        organizationId: orgId,
        role: 'teacher',
        invitedBy: adminUserId,
      },
    ]);

    await db.insert(cpSchema.cpOrganizationUsers).values({
      id: `org-user-${targetUserId}`,
      organizationId: orgId,
      openpathUserId: targetUserId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Delete',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const deleteResp = await trpcMutate(
      integration.baseUrl,
      'users.delete',
      { id: targetUserId },
      bearerAuth(adminToken)
    );
    assertStatus(deleteResp, 200);

    const memberships = await db
      .select()
      .from(cpSchema.cpMemberships)
      .where(
        and(
          eq(cpSchema.cpMemberships.organizationId, orgId),
          eq(cpSchema.cpMemberships.userId, targetUserId)
        )
      );
    assert.strictEqual(memberships.length, 0, 'tenant membership should be removed');

    const orgLinks = await db
      .select()
      .from(cpSchema.cpOrganizationUsers)
      .where(
        and(
          eq(cpSchema.cpOrganizationUsers.organizationId, orgId),
          eq(cpSchema.cpOrganizationUsers.openpathUserId, targetUserId)
        )
      );
    assert.strictEqual(orgLinks.length, 0, 'tenant org-user link should be removed');

    const survivingUsers = await openpathDb
      .select({ id: openpathSchema.users.id })
      .from(openpathSchema.users)
      .where(eq(openpathSchema.users.id, targetUserId));
    assert.strictEqual(survivingUsers.length, 1, 'global OpenPath user should remain');

    const survivingRoles = await openpathDb
      .select()
      .from(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, targetUserId));
    assert.strictEqual(
      survivingRoles.length,
      0,
      'effective OpenPath privileges should be removed when tenant membership is deleted'
    );

    const listResp = await trpcQuery(
      integration.baseUrl,
      'users.list',
      undefined,
      bearerAuth(adminToken)
    );
    assertStatus(listResp, 200);
    const { data: users } = (await parseTRPC(listResp)) as { data: Array<{ id: string }> };
    assert.ok(
      users.every((user) => user.id !== targetUserId),
      'detached user should disappear from tenant list'
    );
  });

  test('users.delete rejects self-delete when the caller is the last tenant admin', async () => {
    const orgId = `org-users-last-admin-delete-${Date.now()}`;
    const adminUserId = `u-last-admin-delete-${Date.now()}`;
    const adminEmail = uniqueEmail('last-admin-delete');

    await openpathDb.insert(openpathSchema.users).values({
      id: adminUserId,
      email: adminEmail,
      name: 'Last Admin Delete',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${adminUserId}`,
      userId: adminUserId,
      role: 'admin',
      groupIds: [],
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${adminUserId}`,
      userId: adminUserId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizationUsers).values({
      id: `org-user-${adminUserId}`,
      organizationId: orgId,
      openpathUserId: adminUserId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Last Admin Delete',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const deleteResp = await trpcMutate(
      integration.baseUrl,
      'users.delete',
      { id: adminUserId },
      bearerAuth(adminToken)
    );
    await assertLastAdminConflict(deleteResp);

    const memberships = await db
      .select()
      .from(cpSchema.cpMemberships)
      .where(eq(cpSchema.cpMemberships.organizationId, orgId));
    assert.strictEqual(memberships.length, 1);
    assert.strictEqual(memberships[0]?.userId, adminUserId);
    assert.strictEqual(memberships[0]?.role, 'admin');

    const orgLinks = await db
      .select()
      .from(cpSchema.cpOrganizationUsers)
      .where(eq(cpSchema.cpOrganizationUsers.organizationId, orgId));
    assert.strictEqual(orgLinks.length, 1);
    assert.strictEqual(orgLinks[0]?.openpathUserId, adminUserId);
  });

  test('users.update mutates tenant-scoped OpenPath profile fields', async () => {
    const orgId = `org-users-update-${Date.now()}`;
    const adminUserId = `u-admin-update-${Date.now()}`;
    const targetUserId = `u-target-update-${Date.now()}`;

    const adminEmail = uniqueEmail('admin-update');
    const targetEmail = uniqueEmail('target-update');

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin Update',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: targetUserId,
        email: targetEmail,
        name: 'Before Update',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
    ]);

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${adminUserId}`,
      userId: adminUserId,
      role: 'admin',
      groupIds: [],
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values([
      {
        id: `mem-${adminUserId}`,
        userId: adminUserId,
        organizationId: orgId,
        role: 'admin',
        invitedBy: adminUserId,
      },
      {
        id: `mem-${targetUserId}`,
        userId: targetUserId,
        organizationId: orgId,
        role: 'teacher',
        invitedBy: adminUserId,
      },
    ]);

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Update',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const updateResp = await trpcMutate(
      integration.baseUrl,
      'users.update',
      { id: targetUserId, name: 'After Update', active: false },
      bearerAuth(adminToken)
    );
    assertStatus(updateResp, 200);

    const { data: updatedUser } = (await parseTRPC(updateResp)) as {
      data: { id: string; name: string; isActive: boolean; roles: Array<{ role: string }> };
    };
    assert.strictEqual(updatedUser.id, targetUserId);
    assert.strictEqual(updatedUser.name, 'After Update');
    assert.strictEqual(updatedUser.isActive, false);
    assert.ok(Array.isArray(updatedUser.roles));

    const [persistedUser] = await openpathDb
      .select()
      .from(openpathSchema.users)
      .where(eq(openpathSchema.users.id, targetUserId));
    assert.strictEqual(persistedUser?.name, 'After Update');
    assert.strictEqual(persistedUser?.isActive, false);
  });

  test('users.assignRole and users.revokeRole keep tenant role state authoritative across ClassroomPath and OpenPath', async () => {
    const orgId = `org-users-role-${Date.now()}`;
    const adminUserId = `u-admin-role-${Date.now()}`;
    const targetUserId = `u-target-role-${Date.now()}`;

    const adminEmail = uniqueEmail('admin-role');
    const targetEmail = uniqueEmail('target-role');

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin Role',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: targetUserId,
        email: targetEmail,
        name: 'Target Role',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
    ]);

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${adminUserId}`,
      userId: adminUserId,
      role: 'admin',
      groupIds: [],
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values([
      {
        id: `mem-${adminUserId}`,
        userId: adminUserId,
        organizationId: orgId,
        role: 'admin',
        invitedBy: adminUserId,
      },
      {
        id: `mem-${targetUserId}`,
        userId: targetUserId,
        organizationId: orgId,
        role: 'teacher',
        invitedBy: adminUserId,
      },
    ]);

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Role',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const createRoleResp = await trpcMutate(
      integration.baseUrl,
      'users.assignRole',
      { userId: targetUserId, role: 'teacher', groupIds: ['group-a'] },
      bearerAuth(adminToken)
    );
    assertStatus(createRoleResp, 200);
    const { data: createdRole } = (await parseTRPC(createRoleResp)) as {
      data: { userId: string; role: string; groupIds: string[] };
    };
    assert.strictEqual(createdRole.userId, targetUserId);
    assert.strictEqual(createdRole.role, 'teacher');
    assert.deepStrictEqual(createdRole.groupIds, ['group-a']);

    const [teacherMembership] = await db
      .select()
      .from(cpSchema.cpMemberships)
      .where(eq(cpSchema.cpMemberships.userId, targetUserId));
    assert.strictEqual(teacherMembership?.role, 'teacher');

    const updateRoleResp = await trpcMutate(
      integration.baseUrl,
      'users.assignRole',
      { userId: targetUserId, role: 'admin', groupIds: ['group-b'] },
      bearerAuth(adminToken)
    );
    assertStatus(updateRoleResp, 200);
    const { data: updatedRole } = (await parseTRPC(updateRoleResp)) as {
      data: { userId: string; role: string; groupIds: string[] };
    };
    assert.strictEqual(updatedRole.userId, targetUserId);
    assert.strictEqual(updatedRole.role, 'admin');
    assert.deepStrictEqual(updatedRole.groupIds, ['group-b']);

    const [adminMembership] = await db
      .select()
      .from(cpSchema.cpMemberships)
      .where(eq(cpSchema.cpMemberships.userId, targetUserId));
    assert.strictEqual(adminMembership?.role, 'admin');

    const revokeRoleResp = await trpcMutate(
      integration.baseUrl,
      'users.revokeRole',
      { userId: targetUserId },
      bearerAuth(adminToken)
    );
    assertStatus(revokeRoleResp, 200);

    const remainingRoles = await openpathDb
      .select()
      .from(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, targetUserId));
    assert.strictEqual(remainingRoles.length, 1);
    assert.strictEqual(String(remainingRoles[0]?.role), 'teacher');
    assert.deepStrictEqual(remainingRoles[0]?.groupIds ?? [], []);

    const [revokedMembership] = await db
      .select()
      .from(cpSchema.cpMemberships)
      .where(eq(cpSchema.cpMemberships.userId, targetUserId));
    assert.strictEqual(revokedMembership?.role, 'teacher');
  });

  test('users.assignRole and users.revokeRole reject self-demotion for the last tenant admin', async () => {
    const orgId = `org-users-last-admin-demote-${Date.now()}`;
    const adminUserId = `u-last-admin-demote-${Date.now()}`;
    const adminEmail = uniqueEmail('last-admin-demote');

    await openpathDb.insert(openpathSchema.users).values({
      id: adminUserId,
      email: adminEmail,
      name: 'Last Admin Demote',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${adminUserId}`,
      userId: adminUserId,
      role: 'admin',
      groupIds: [],
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${adminUserId}`,
      userId: adminUserId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: adminUserId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Last Admin Demote',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const assignResp = await trpcMutate(
      integration.baseUrl,
      'users.assignRole',
      { userId: adminUserId, role: 'teacher', groupIds: [] },
      bearerAuth(adminToken)
    );
    await assertLastAdminConflict(assignResp);

    const revokeResp = await trpcMutate(
      integration.baseUrl,
      'users.revokeRole',
      { userId: adminUserId },
      bearerAuth(adminToken)
    );
    await assertLastAdminConflict(revokeResp);

    const [membership] = await db
      .select()
      .from(cpSchema.cpMemberships)
      .where(eq(cpSchema.cpMemberships.userId, adminUserId));
    assert.strictEqual(membership?.role, 'admin');

    const persistedRoles = await openpathDb
      .select()
      .from(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, adminUserId));
    assert.strictEqual(persistedRoles.length, 1);
    assert.strictEqual(String(persistedRoles[0]?.role), 'admin');
  });

  test('users.assignRole and users.revokeRole reject users outside the tenant scope', async () => {
    const orgId = `org-users-role-forbidden-${Date.now()}`;
    const adminUserId = `u-admin-role-forbidden-${Date.now()}`;
    const outsiderUserId = `u-outsider-role-forbidden-${Date.now()}`;

    const adminEmail = uniqueEmail('admin-role-forbidden');
    const outsiderEmail = uniqueEmail('outsider-role-forbidden');

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin Forbidden',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: outsiderUserId,
        email: outsiderEmail,
        name: 'Outsider User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
    ]);

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${adminUserId}`,
      userId: adminUserId,
      role: 'admin',
      groupIds: [],
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${adminUserId}`,
      userId: adminUserId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: adminUserId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Forbidden',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const assignResp = await trpcMutate(
      integration.baseUrl,
      'users.assignRole',
      { userId: outsiderUserId, role: 'teacher', groupIds: [] },
      bearerAuth(adminToken)
    );
    const assignParsed = (await parseTRPC(assignResp)) as { error?: string; code?: string };
    assert.ok(assignParsed.error, 'Expected error payload');
    assert.strictEqual(assignParsed.code, 'FORBIDDEN');

    const revokeResp = await trpcMutate(
      integration.baseUrl,
      'users.revokeRole',
      { userId: outsiderUserId },
      bearerAuth(adminToken)
    );
    const revokeParsed = (await parseTRPC(revokeResp)) as { error?: string; code?: string };
    assert.ok(revokeParsed.error, 'Expected error payload');
    assert.strictEqual(revokeParsed.code, 'FORBIDDEN');
  });

  test('users.delete rejects users outside the tenant scope', async () => {
    const orgId = `org-users-delete-forbidden-${Date.now()}`;
    const adminUserId = `u-admin-delete-forbidden-${Date.now()}`;
    const outsiderUserId = `u-outsider-delete-forbidden-${Date.now()}`;

    const adminEmail = uniqueEmail('admin-delete-forbidden');
    const outsiderEmail = uniqueEmail('outsider-delete-forbidden');

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin Delete Forbidden',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: outsiderUserId,
        email: outsiderEmail,
        name: 'Delete Outsider',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
    ]);

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${adminUserId}`,
      userId: adminUserId,
      role: 'admin',
      groupIds: [],
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${adminUserId}`,
      userId: adminUserId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: adminUserId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Delete Forbidden',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const deleteResp = await trpcMutate(
      integration.baseUrl,
      'users.delete',
      { id: outsiderUserId },
      bearerAuth(adminToken)
    );
    const deleteParsed = (await parseTRPC(deleteResp)) as { error?: string; code?: string };
    assert.ok(deleteParsed.error, 'Expected error payload');
    assert.strictEqual(deleteParsed.code, 'FORBIDDEN');
  });
});
