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
import { createTenantScenario } from './scenario-builder.js';

import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';

const integration = useIntegrationServer({ resetBeforeStart: true });
const LAST_ADMIN_MESSAGE = /last admin|at least one.*admin/i;

function getScenario() {
  return createTenantScenario({ baseUrl: integration.baseUrl, jwtSecret: JWT_SECRET });
}

async function assertLastAdminConflict(response: Response): Promise<void> {
  assertStatus(response, 409);
  const { code, error } = await parseTRPC(response);
  assert.strictEqual(code, 'CONFLICT');
  assert.match(error ?? '', LAST_ADMIN_MESSAGE);
}

function requireAuditEvent(
  events: Array<{
    action: string;
    actorUserId: string;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown>;
  }>,
  action: string,
  targetId: string
) {
  const event = events.find(
    (candidate) => candidate.action === action && candidate.targetId === targetId
  );
  assert.ok(event, `expected audit event ${action} for ${targetId}`);
  return event!;
}

describe('ClassroomPath users integration (/cp/trpc)', { concurrency: 1 }, async () => {
  test('users.list returns SafeUserWithRoles and never exposes passwordHash', async () => {
    const adminUserId = `u-admin-${Date.now()}`;
    const teacherUserId = `u-teacher-${Date.now()}`;
    const scenario = getScenario();
    const { actor: admin, organization } = await scenario.seedOrgAdmin({
      userId: adminUserId,
      organizationName: `Org users ${Date.now()}`,
    });
    const teacher = await scenario.seedMember({
      organizationId: organization.organizationId,
      invitedBy: admin.userId,
      role: 'teacher',
      userId: teacherUserId,
    });

    const resp = await trpcQuery(
      integration.baseUrl,
      'users.list',
      undefined,
      bearerAuth(admin.token)
    );
    assertStatus(resp, 200);

    const { data } = (await parseTRPC(resp)) as { data: any };
    assert.ok(Array.isArray(data), 'users.list must return an array');

    const byEmail = new Map<string, any>(data.map((u: any) => [u.email, u]));
    assert.ok(byEmail.has(admin.email), 'admin user should be present in users.list');
    assert.ok(byEmail.has(teacher.email), 'teacher user should be present in users.list');

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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
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

    const auditEvents = await db
      .select()
      .from(cpSchema.cpAuditEvents)
      .where(eq(cpSchema.cpAuditEvents.organizationId, orgId));
    const invitationCreated = requireAuditEvent(auditEvents, 'invitation.created', invitation.id);
    assert.strictEqual(invitationCreated.actorUserId, adminUserId);
    assert.strictEqual(invitationCreated.targetType, 'invitation');
    assert.deepStrictEqual(invitationCreated.metadata, {
      email: invitedEmail,
      name: 'Created Teacher',
      role: 'teacher',
    });

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

  test('users.revokeInvitation removes the invitation and emits a durable audit event', async () => {
    const orgId = `org-users-revoke-invite-${Date.now()}`;
    const adminUserId = `u-admin-revoke-invite-${Date.now()}`;
    const adminEmail = uniqueEmail('admin-revoke-invite');

    await openpathDb.insert(openpathSchema.users).values({
      id: adminUserId,
      email: adminEmail,
      name: 'Admin Revoke Invite',
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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Revoke Invite',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const invitedEmail = uniqueEmail('revoked-invitee');
    const createResp = await trpcMutate(
      integration.baseUrl,
      'users.create',
      {
        email: invitedEmail,
        name: 'Revoked Invitee',
        role: 'teacher',
      },
      bearerAuth(adminToken)
    );
    assertStatus(createResp, 200);

    const { data: invitation } = (await parseTRPC(createResp)) as {
      data: { id: string };
    };

    const revokeResp = await trpcMutate(
      integration.baseUrl,
      'users.revokeInvitation',
      { invitationId: invitation.id },
      bearerAuth(adminToken)
    );
    assertStatus(revokeResp, 200);

    const invitations = await db
      .select()
      .from(cpSchema.cpInvitations)
      .where(eq(cpSchema.cpInvitations.organizationId, orgId));
    assert.strictEqual(invitations.length, 0);

    const auditEvents = await db
      .select()
      .from(cpSchema.cpAuditEvents)
      .where(eq(cpSchema.cpAuditEvents.organizationId, orgId));
    const invitationRevoked = requireAuditEvent(auditEvents, 'invitation.revoked', invitation.id);
    assert.strictEqual(invitationRevoked.actorUserId, adminUserId);
    assert.strictEqual(invitationRevoked.targetType, 'invitation');
    assert.strictEqual(invitationRevoked.metadata.email, invitedEmail);
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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: userId,
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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
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

    const auditEvents = await db
      .select()
      .from(cpSchema.cpAuditEvents)
      .where(eq(cpSchema.cpAuditEvents.organizationId, orgId));
    const userDeleted = requireAuditEvent(auditEvents, 'user.deleted', targetUserId);
    assert.strictEqual(userDeleted.actorUserId, adminUserId);
    assert.strictEqual(userDeleted.targetType, 'user');
    assert.deepStrictEqual(userDeleted.metadata, { role: 'teacher' });
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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
    });

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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
    });

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

    const auditEvents = await db
      .select()
      .from(cpSchema.cpAuditEvents)
      .where(eq(cpSchema.cpAuditEvents.organizationId, orgId));
    const assignedEvents = auditEvents.filter(
      (event) => event.action === 'user.role-assigned' && event.targetId === targetUserId
    );
    assert.strictEqual(assignedEvents.length, 2);
    assert.ok(
      assignedEvents.some(
        (event) =>
          event.actorUserId === adminUserId &&
          event.targetType === 'user' &&
          event.metadata.role === 'teacher' &&
          Array.isArray(event.metadata.groupIds) &&
          event.metadata.groupIds.length === 1 &&
          event.metadata.groupIds[0] === 'group-a'
      )
    );
    assert.ok(
      assignedEvents.some(
        (event) =>
          event.actorUserId === adminUserId &&
          event.targetType === 'user' &&
          event.metadata.role === 'admin' &&
          Array.isArray(event.metadata.groupIds) &&
          event.metadata.groupIds.length === 1 &&
          event.metadata.groupIds[0] === 'group-b'
      )
    );

    const revokedEvent = requireAuditEvent(auditEvents, 'user.role-revoked', targetUserId);
    assert.strictEqual(revokedEvent.actorUserId, adminUserId);
    assert.strictEqual(revokedEvent.targetType, 'user');
    assert.deepStrictEqual(revokedEvent.metadata, {
      role: 'teacher',
      groupIds: [],
    });
  });

  test('pendingUsers.approve and pendingUsers.reject emit durable audit events', async () => {
    const orgId = `org-users-pending-audit-${Date.now()}`;
    const adminUserId = `u-admin-pending-audit-${Date.now()}`;
    const approvedUserId = `u-approved-pending-audit-${Date.now()}`;
    const rejectedUserId = `u-rejected-pending-audit-${Date.now()}`;

    const adminEmail = uniqueEmail('admin-pending-audit');
    const approvedEmail = uniqueEmail('approved-pending-audit');
    const rejectedEmail = uniqueEmail('rejected-pending-audit');

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin Pending Audit',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: approvedUserId,
        email: approvedEmail,
        name: 'Approved Pending Audit',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: rejectedUserId,
        email: rejectedEmail,
        name: 'Rejected Pending Audit',
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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
    });

    await db.insert(cpSchema.cpUserStatus).values([
      {
        userId: approvedUserId,
        status: 'waiting',
        targetOrganizationId: orgId,
      },
      {
        userId: rejectedUserId,
        status: 'waiting',
        targetOrganizationId: orgId,
      },
    ]);

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Pending Audit',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const approveResp = await trpcMutate(
      integration.baseUrl,
      'pendingUsers.approve',
      { userId: approvedUserId, role: 'teacher' },
      bearerAuth(adminToken)
    );
    assertStatus(approveResp, 200);
    const { data: approved } = (await parseTRPC(approveResp)) as {
      data: { membershipId: string; success: boolean };
    };
    assert.strictEqual(approved.success, true);

    const rejectResp = await trpcMutate(
      integration.baseUrl,
      'pendingUsers.reject',
      { userId: rejectedUserId },
      bearerAuth(adminToken)
    );
    assertStatus(rejectResp, 200);

    const auditEvents = await db
      .select()
      .from(cpSchema.cpAuditEvents)
      .where(eq(cpSchema.cpAuditEvents.organizationId, orgId));
    const pendingApproved = requireAuditEvent(auditEvents, 'pending-user.approved', approvedUserId);
    assert.strictEqual(pendingApproved.actorUserId, adminUserId);
    assert.strictEqual(pendingApproved.targetType, 'user');
    assert.deepStrictEqual(pendingApproved.metadata, {
      membershipId: approved.membershipId,
      role: 'teacher',
    });

    const pendingRejected = requireAuditEvent(auditEvents, 'pending-user.rejected', rejectedUserId);
    assert.strictEqual(pendingRejected.actorUserId, adminUserId);
    assert.strictEqual(pendingRejected.targetType, 'user');
    assert.deepStrictEqual(pendingRejected.metadata, {});
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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
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

    await db.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
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
