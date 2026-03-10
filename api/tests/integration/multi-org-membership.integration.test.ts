const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { TRPCError } from '@trpc/server';
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { and, eq, sql } from 'drizzle-orm';

import {
  assertStatus,
  bearerAuth,
  parseTRPC,
  resetDb,
  trpcMutate,
  trpcQuery,
  uniqueEmail,
} from '../test-utils.js';
import { signToken, useIntegrationServer } from './harness.js';

import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import {
  deleteOrganizationUser,
  revokeOrganizationUserRole,
} from '../../src/services/user.service.js';

const integration = useIntegrationServer({ resetBeforeStart: true });
const SINGLE_ORG_CONSTRAINT = 'cp_memberships_user_id_key';
const CONFLICT_MESSAGE = /single organization|ambiguous/i;
const LAST_ADMIN_MESSAGE = /last admin|at least one.*admin/i;

async function assertConflictResponse(response: Response): Promise<void> {
  const parsed = await parseTRPC(response);
  assert.ok(parsed.error, 'Expected error payload');
  assert.strictEqual(parsed.code, 'CONFLICT');
  assert.match(parsed.error ?? '', CONFLICT_MESSAGE);
}

async function assertLastAdminServiceConflict(action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof TRPCError);
    assert.strictEqual(error.code, 'CONFLICT');
    assert.match(error.message, LAST_ADMIN_MESSAGE);
    return true;
  });
}

async function dropSingleOrgConstraint(): Promise<void> {
  await db.execute(
    sql.raw(`ALTER TABLE "cp_memberships" DROP CONSTRAINT IF EXISTS "${SINGLE_ORG_CONSTRAINT}"`)
  );
}

async function restoreSingleOrgConstraint(): Promise<void> {
  await db.execute(
    sql.raw(
      `ALTER TABLE "cp_memberships" ADD CONSTRAINT "${SINGLE_ORG_CONSTRAINT}" UNIQUE("user_id")`
    )
  );
}

describe('ClassroomPath multi-org membership hardening', { concurrency: 1 }, async () => {
  test('onboarding.createOrganization rejects users who already belong to another organization', async () => {
    await resetDb();

    const userId = `multi-org-create-${Date.now()}`;
    const email = uniqueEmail('multi-org-create');
    const existingOrgId = `org-existing-${Date.now()}`;

    await openpathDb.insert(openpathSchema.users).values({
      id: userId,
      email,
      name: 'Already Member',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: existingOrgId,
      name: `Org ${existingOrgId}`,
      createdBy: userId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-existing-${userId}`,
      userId,
      organizationId: existingOrgId,
      role: 'admin',
      invitedBy: userId,
    });

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId,
      email,
      name: 'Already Member',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const response = await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      { name: 'Second Org' },
      bearerAuth(token)
    );
    await assertConflictResponse(response);
  });

  test('pendingUsers.approve rejects users who already belong to a different organization', async () => {
    await resetDb();

    const adminUserId = `multi-org-admin-${Date.now()}`;
    const adminEmail = uniqueEmail('multi-org-admin');
    const inviteeUserId = `multi-org-invitee-${Date.now()}`;
    const inviteeEmail = uniqueEmail('multi-org-invitee');
    const currentOrgId = `org-current-${Date.now()}`;
    const otherOrgId = `org-other-${Date.now()}`;

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
        id: inviteeUserId,
        email: inviteeEmail,
        name: 'Invitee User',
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

    await db.insert(cpSchema.cpOrganizations).values([
      {
        id: currentOrgId,
        name: `Org ${currentOrgId}`,
        createdBy: adminUserId,
      },
      {
        id: otherOrgId,
        name: `Org ${otherOrgId}`,
        createdBy: inviteeUserId,
      },
    ]);

    await db.insert(cpSchema.cpMemberships).values([
      {
        id: `mem-${adminUserId}`,
        userId: adminUserId,
        organizationId: currentOrgId,
        role: 'admin',
        invitedBy: adminUserId,
      },
      {
        id: `mem-${inviteeUserId}`,
        userId: inviteeUserId,
        organizationId: otherOrgId,
        role: 'teacher',
        invitedBy: inviteeUserId,
      },
    ]);

    await db.insert(cpSchema.cpUserStatus).values({
      userId: inviteeUserId,
      status: 'waiting',
      targetOrganizationId: currentOrgId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const response = await trpcMutate(
      integration.baseUrl,
      'pendingUsers.approve',
      { userId: inviteeUserId, role: 'teacher' },
      bearerAuth(adminToken)
    );
    await assertConflictResponse(response);
  });

  test('onboarding.waitForInvitation auto-targets the only organization when none is selected', async () => {
    await resetDb();

    const userId = `multi-org-wait-single-${Date.now()}`;
    const email = uniqueEmail('multi-org-wait-single');
    const orgId = `org-wait-single-${Date.now()}`;

    await openpathDb.insert(openpathSchema.users).values({
      id: userId,
      email,
      name: 'Single Org User',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: userId,
    });

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId,
      email,
      name: 'Single Org User',
      roles: [{ role: 'teacher', groupIds: [] }],
    });

    const response = await trpcMutate(
      integration.baseUrl,
      'onboarding.waitForInvitation',
      {},
      bearerAuth(token)
    );
    assertStatus(response, 200);

    const waitingStatus = await db
      .select()
      .from(cpSchema.cpUserStatus)
      .where(eq(cpSchema.cpUserStatus.userId, userId));
    assert.strictEqual(waitingStatus.length, 1);
    assert.strictEqual(waitingStatus[0]?.targetOrganizationId, orgId);
  });

  test('onboarding.waitForInvitation rejects implicit selection when no organizations exist', async () => {
    await resetDb();

    const userId = `multi-org-wait-none-${Date.now()}`;
    const email = uniqueEmail('multi-org-wait-none');

    await openpathDb.insert(openpathSchema.users).values({
      id: userId,
      email,
      name: 'No Org User',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId,
      email,
      name: 'No Org User',
      roles: [{ role: 'teacher', groupIds: [] }],
    });

    const response = await trpcMutate(
      integration.baseUrl,
      'onboarding.waitForInvitation',
      {},
      bearerAuth(token)
    );
    const parsed = await parseTRPC(response);
    assert.ok(parsed.error, 'Expected error payload');
    assert.strictEqual(parsed.code, 'BAD_REQUEST');
    assert.match(parsed.error ?? '', /No hay organizaciones disponibles/i);
  });

  test('onboarding.waitForInvitation requires explicit selection when multiple organizations exist', async () => {
    await resetDb();

    const userId = `multi-org-wait-many-${Date.now()}`;
    const email = uniqueEmail('multi-org-wait-many');
    const firstOrgId = `org-wait-many-a-${Date.now()}`;
    const secondOrgId = `org-wait-many-b-${Date.now()}`;

    await openpathDb.insert(openpathSchema.users).values({
      id: userId,
      email,
      name: 'Many Org User',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    await db.insert(cpSchema.cpOrganizations).values([
      {
        id: firstOrgId,
        name: `Org ${firstOrgId}`,
        createdBy: userId,
      },
      {
        id: secondOrgId,
        name: `Org ${secondOrgId}`,
        createdBy: userId,
      },
    ]);

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId,
      email,
      name: 'Many Org User',
      roles: [{ role: 'teacher', groupIds: [] }],
    });

    const response = await trpcMutate(
      integration.baseUrl,
      'onboarding.waitForInvitation',
      {},
      bearerAuth(token)
    );
    const parsed = await parseTRPC(response);
    assert.ok(parsed.error, 'Expected error payload');
    assert.strictEqual(parsed.code, 'BAD_REQUEST');
    assert.match(parsed.error ?? '', /Debes seleccionar una organización/i);
  });

  test('onboarding.cancelWaiting clears the stored waiting status', async () => {
    await resetDb();

    const userId = `multi-org-cancel-wait-${Date.now()}`;
    const email = uniqueEmail('multi-org-cancel-wait');
    const orgId = `org-cancel-wait-${Date.now()}`;

    await openpathDb.insert(openpathSchema.users).values({
      id: userId,
      email,
      name: 'Cancel Waiting User',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: userId,
    });

    await db.insert(cpSchema.cpUserStatus).values({
      userId,
      status: 'waiting',
      targetOrganizationId: orgId,
    });

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId,
      email,
      name: 'Cancel Waiting User',
      roles: [{ role: 'teacher', groupIds: [] }],
    });

    const response = await trpcMutate(
      integration.baseUrl,
      'onboarding.cancelWaiting',
      {},
      bearerAuth(token)
    );
    assertStatus(response, 200);

    const waitingStatus = await db
      .select()
      .from(cpSchema.cpUserStatus)
      .where(eq(cpSchema.cpUserStatus.userId, userId));
    assert.strictEqual(waitingStatus.length, 0);
  });

  test('onboarding.status rejects ambiguous legacy memberships', async () => {
    await resetDb();
    await dropSingleOrgConstraint();

    try {
      const userId = `multi-org-status-${Date.now()}`;
      const email = uniqueEmail('multi-org-status');
      const firstOrgId = `org-status-a-${Date.now()}`;
      const secondOrgId = `org-status-b-${Date.now()}`;

      await openpathDb.insert(openpathSchema.users).values({
        id: userId,
        email,
        name: 'Ambiguous User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      });

      await db.insert(cpSchema.cpOrganizations).values([
        {
          id: firstOrgId,
          name: `Org ${firstOrgId}`,
          createdBy: userId,
        },
        {
          id: secondOrgId,
          name: `Org ${secondOrgId}`,
          createdBy: userId,
        },
      ]);

      await db.insert(cpSchema.cpMemberships).values([
        {
          id: `mem-a-${userId}`,
          userId,
          organizationId: firstOrgId,
          role: 'admin',
          invitedBy: userId,
        },
        {
          id: `mem-b-${userId}`,
          userId,
          organizationId: secondOrgId,
          role: 'teacher',
          invitedBy: userId,
        },
      ]);

      const token = signToken({
        jwtSecret: JWT_SECRET,
        userId,
        email,
        name: 'Ambiguous User',
        roles: [{ role: 'admin', groupIds: [] }],
      });

      const response = await trpcQuery(
        integration.baseUrl,
        'onboarding.status',
        undefined,
        bearerAuth(token)
      );
      await assertConflictResponse(response);
    } finally {
      await resetDb();
      await restoreSingleOrgConstraint();
    }
  });

  test('tenant-scoped user mutations reject ambiguous legacy memberships', async () => {
    await resetDb();
    await dropSingleOrgConstraint();

    try {
      const adminUserId = `multi-org-tenant-admin-${Date.now()}`;
      const adminEmail = uniqueEmail('multi-org-tenant-admin');
      const targetUserId = `multi-org-tenant-target-${Date.now()}`;
      const targetEmail = uniqueEmail('multi-org-tenant-target');
      const firstOrgId = `org-tenant-a-${Date.now()}`;
      const secondOrgId = `org-tenant-b-${Date.now()}`;

      await openpathDb.insert(openpathSchema.users).values([
        {
          id: adminUserId,
          email: adminEmail,
          name: 'Ambiguous Admin',
          passwordHash: 'hashed',
          isActive: true,
          emailVerified: true,
        },
        {
          id: targetUserId,
          email: targetEmail,
          name: 'Target User',
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

      await db.insert(cpSchema.cpOrganizations).values([
        {
          id: firstOrgId,
          name: `Org ${firstOrgId}`,
          createdBy: adminUserId,
        },
        {
          id: secondOrgId,
          name: `Org ${secondOrgId}`,
          createdBy: adminUserId,
        },
      ]);

      await db.insert(cpSchema.cpMemberships).values([
        {
          id: `mem-a-${adminUserId}`,
          userId: adminUserId,
          organizationId: firstOrgId,
          role: 'admin',
          invitedBy: adminUserId,
        },
        {
          id: `mem-b-${adminUserId}`,
          userId: adminUserId,
          organizationId: secondOrgId,
          role: 'admin',
          invitedBy: adminUserId,
        },
        {
          id: `mem-${targetUserId}`,
          userId: targetUserId,
          organizationId: firstOrgId,
          role: 'teacher',
          invitedBy: adminUserId,
        },
      ]);

      const adminToken = signToken({
        jwtSecret: JWT_SECRET,
        userId: adminUserId,
        email: adminEmail,
        name: 'Ambiguous Admin',
        roles: [{ role: 'admin', groupIds: [] }],
      });

      const listResponse = await trpcQuery(
        integration.baseUrl,
        'users.list',
        undefined,
        bearerAuth(adminToken)
      );
      await assertConflictResponse(listResponse);

      const assignResponse = await trpcMutate(
        integration.baseUrl,
        'users.assignRole',
        { userId: targetUserId, role: 'teacher', groupIds: [] },
        bearerAuth(adminToken)
      );
      await assertConflictResponse(assignResponse);

      const revokeResponse = await trpcMutate(
        integration.baseUrl,
        'users.revokeRole',
        { userId: targetUserId },
        bearerAuth(adminToken)
      );
      await assertConflictResponse(revokeResponse);
    } finally {
      await resetDb();
      await restoreSingleOrgConstraint();
    }
  });

  test('tenant-scoped user services reject removing or demoting the last admin membership', async () => {
    await resetDb();

    const actorUserId = `last-admin-actor-${Date.now()}`;
    const actorEmail = uniqueEmail('last-admin-actor');
    const targetUserId = `last-admin-target-${Date.now()}`;
    const targetEmail = uniqueEmail('last-admin-target');
    const orgId = `org-last-admin-service-${Date.now()}`;

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: actorUserId,
        email: actorEmail,
        name: 'Actor User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: targetUserId,
        email: targetEmail,
        name: 'Target Admin',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
    ]);

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${targetUserId}`,
      userId: targetUserId,
      role: 'admin',
      groupIds: [],
      createdBy: actorUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: actorUserId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${targetUserId}`,
      userId: targetUserId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: actorUserId,
    });

    await db.insert(cpSchema.cpOrganizationUsers).values({
      id: `org-user-${targetUserId}`,
      organizationId: orgId,
      openpathUserId: targetUserId,
    });

    await assertLastAdminServiceConflict(() =>
      deleteOrganizationUser({
        organizationId: orgId,
        userId: targetUserId,
        actedBy: actorUserId,
      })
    );

    await assertLastAdminServiceConflict(() =>
      revokeOrganizationUserRole({
        organizationId: orgId,
        userId: targetUserId,
        actedBy: actorUserId,
      })
    );

    const [membership] = await db
      .select()
      .from(cpSchema.cpMemberships)
      .where(eq(cpSchema.cpMemberships.userId, targetUserId));
    assert.strictEqual(membership?.role, 'admin');

    const orgLinks = await db
      .select()
      .from(cpSchema.cpOrganizationUsers)
      .where(eq(cpSchema.cpOrganizationUsers.openpathUserId, targetUserId));
    assert.strictEqual(orgLinks.length, 1);
  });
});
