import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import {
  listOrganizationMutationOperations,
  retryOrganizationMutationOperation,
} from '../src/services/cross-system-reconciliation.service.js';
import {
  getOrCreateMutationOperation,
  setMutationOperationProgress,
} from '../src/lib/cross-system-mutations.js';
import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { resetDb, withTestDbLock } from './test-db.js';

describe('cross-system-reconciliation.service', () => {
  async function seedAdminOrganization(): Promise<void> {
    await openpathDb.insert(openpathSchema.users).values({
      id: 'admin_recon',
      email: 'admin_recon@example.com',
      name: 'Recon Admin',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    await db.insert(schema.cpOrganizations).values({
      id: 'org_recon',
      name: 'Recon Org',
      createdBy: 'admin_recon',
    });

    await db.insert(schema.cpMemberships).values({
      id: 'mem_admin_recon',
      organizationId: 'org_recon',
      userId: 'admin_recon',
      role: 'admin',
      invitedBy: 'admin_recon',
    });
  }

  afterEach(async () => {
    await withTestDbLock(async () => {
      await resetDb();
    });
  });

  test('lists organization mutation operations filtered by status', async () => {
    await withTestDbLock(async () => {
      await db.insert(schema.cpOrganizations).values({
        id: 'org_recon',
        name: 'Recon Org',
        createdBy: 'admin_recon',
      });

      const operation = await getOrCreateMutationOperation({
        operationType: 'users.assign_role',
        idempotencyKey: 'org_recon:user_recon:teacher:',
        organizationId: 'org_recon',
        userId: 'user_recon',
      });

      await setMutationOperationProgress(operation.id, {
        step: 'failed',
        status: 'failed',
        lastError: { message: 'sync failed' },
      });

      const failed = await listOrganizationMutationOperations({
        organizationId: 'org_recon',
        status: 'failed',
      });

      assert.strictEqual(failed.length, 1);
      assert.strictEqual(failed[0]?.operationType, 'users.assign_role');
      assert.strictEqual(failed[0]?.status, 'failed');
    });
  });

  test('retries a failed role assignment operation', async () => {
    await withTestDbLock(async () => {
      await openpathDb.insert(openpathSchema.users).values({
        id: 'admin_recon',
        email: 'admin_recon@example.com',
        name: 'Recon Admin',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      });
      await openpathDb.insert(openpathSchema.users).values({
        id: 'user_recon',
        email: 'user_recon@example.com',
        name: 'Recon User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      });
      await openpathDb.insert(openpathSchema.whitelistGroups).values({
        id: 'group_recon',
        name: 'group_recon',
        displayName: 'Recon Group',
        enabled: 1,
      });

      await db.insert(schema.cpOrganizations).values({
        id: 'org_recon',
        name: 'Recon Org',
        createdBy: 'admin_recon',
      });
      await db.insert(schema.cpMemberships).values([
        {
          id: 'mem_admin_recon',
          organizationId: 'org_recon',
          userId: 'admin_recon',
          role: 'admin',
          invitedBy: 'admin_recon',
        },
        {
          id: 'mem_user_recon',
          organizationId: 'org_recon',
          userId: 'user_recon',
          role: 'teacher',
          invitedBy: 'admin_recon',
        },
      ]);

      const operation = await getOrCreateMutationOperation({
        operationType: 'users.assign_role',
        idempotencyKey: 'org_recon:user_recon:admin:group_recon',
        organizationId: 'org_recon',
        userId: 'user_recon',
        metadata: { role: 'admin', groupIds: ['group_recon'], actedBy: 'admin_recon' },
      });

      await setMutationOperationProgress(operation.id, {
        step: 'failed',
        status: 'failed',
        result: { role: 'admin', groupIds: ['group_recon'], createdBy: 'admin_recon' },
        lastError: { message: 'sync failed' },
      });

      const retried = await retryOrganizationMutationOperation({
        organizationId: 'org_recon',
        operationId: operation.id,
        actedBy: 'admin_recon',
      });

      assert.ok(retried);

      const [membership] = await db
        .select()
        .from(schema.cpMemberships)
        .where(eq(schema.cpMemberships.userId, 'user_recon'))
        .limit(1);
      const [role] = await openpathDb
        .select()
        .from(openpathSchema.roles)
        .where(eq(openpathSchema.roles.userId, 'user_recon'))
        .limit(1);

      assert.strictEqual(membership?.role, 'admin');
      assert.strictEqual(role?.role, 'admin');
      assert.deepStrictEqual(role?.groupIds, ['group_recon']);
    });
  });

  test('throws not found when retry target does not exist', async () => {
    await withTestDbLock(async () => {
      await assert.rejects(
        () =>
          retryOrganizationMutationOperation({
            organizationId: 'org_missing',
            operationId: 'missing-operation',
            actedBy: 'admin_recon',
          }),
        (error: unknown) => {
          assert.ok(error instanceof TRPCError);
          assert.strictEqual(error.code, 'NOT_FOUND');
          return true;
        }
      );
    });
  });

  test('rejects unsupported retry operations', async () => {
    await withTestDbLock(async () => {
      await db.insert(schema.cpOrganizations).values({
        id: 'org_recon',
        name: 'Recon Org',
        createdBy: 'admin_recon',
      });

      const operation = await getOrCreateMutationOperation({
        operationType: 'unsupported.operation',
        idempotencyKey: 'unsupported-key',
        organizationId: 'org_recon',
        userId: 'user_recon',
      });

      await assert.rejects(
        () =>
          retryOrganizationMutationOperation({
            organizationId: 'org_recon',
            operationId: operation.id,
            actedBy: 'admin_recon',
          }),
        (error: unknown) => {
          assert.ok(error instanceof TRPCError);
          assert.strictEqual(error.code, 'BAD_REQUEST');
          return true;
        }
      );
    });
  });

  test('retries failed group and classroom delete operations', async () => {
    await withTestDbLock(async () => {
      await openpathDb.insert(openpathSchema.users).values({
        id: 'admin_recon',
        email: 'admin_recon@example.com',
        name: 'Recon Admin',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      });
      await db.insert(schema.cpOrganizations).values({
        id: 'org_recon',
        name: 'Recon Org',
        createdBy: 'admin_recon',
      });
      await db.insert(schema.cpMemberships).values({
        id: 'mem_admin_recon',
        organizationId: 'org_recon',
        userId: 'admin_recon',
        role: 'admin',
        invitedBy: 'admin_recon',
      });

      await openpathDb.insert(openpathSchema.whitelistGroups).values({
        id: 'group_delete_recon',
        name: 'group_delete_recon',
        displayName: 'Delete Recon Group',
        enabled: 1,
      });
      await db.insert(schema.cpOrganizationGroups).values({
        id: 'org_group_delete_recon',
        organizationId: 'org_recon',
        groupId: 'group_delete_recon',
        publicName: 'group-delete-recon',
      });

      const deleteGroupOperation = await getOrCreateMutationOperation({
        operationType: 'groups.delete_group',
        idempotencyKey: 'org_recon:group_delete_recon',
        organizationId: 'org_recon',
        userId: 'admin_recon',
        metadata: { groupId: 'group_delete_recon', userRole: 'admin' },
      });
      await setMutationOperationProgress(deleteGroupOperation.id, {
        step: 'failed',
        status: 'failed',
        lastError: { message: 'cleanup failed' },
      });

      const retriedGroupDelete = await retryOrganizationMutationOperation({
        organizationId: 'org_recon',
        operationId: deleteGroupOperation.id,
        actedBy: 'admin_recon',
      });

      assert.deepStrictEqual(retriedGroupDelete, { success: true });

      const remainingGroupLinks = await db
        .select()
        .from(schema.cpOrganizationGroups)
        .where(eq(schema.cpOrganizationGroups.groupId, 'group_delete_recon'));
      assert.strictEqual(remainingGroupLinks.length, 0);

      await openpathDb.insert(openpathSchema.classrooms).values({
        id: 'classroom_delete_recon',
        name: 'classroom_delete_recon',
        displayName: 'Delete Recon Classroom',
      });
      await db.insert(schema.cpOrganizationClassrooms).values({
        id: 'org_classroom_delete_recon',
        organizationId: 'org_recon',
        classroomId: 'classroom_delete_recon',
      });

      const deleteClassroomOperation = await getOrCreateMutationOperation({
        operationType: 'classrooms.delete_classroom',
        idempotencyKey: 'org_recon:classroom_delete_recon',
        organizationId: 'org_recon',
        userId: 'admin_recon',
        metadata: { classroomId: 'classroom_delete_recon' },
      });
      await setMutationOperationProgress(deleteClassroomOperation.id, {
        step: 'failed',
        status: 'failed',
        lastError: { message: 'delete failed' },
      });

      const retriedClassroomDelete = await retryOrganizationMutationOperation({
        organizationId: 'org_recon',
        operationId: deleteClassroomOperation.id,
        actedBy: 'admin_recon',
      });

      assert.deepStrictEqual(retriedClassroomDelete, { success: true });

      const remainingClassrooms = await openpathDb
        .select()
        .from(openpathSchema.classrooms)
        .where(eq(openpathSchema.classrooms.id, 'classroom_delete_recon'));
      assert.strictEqual(remainingClassrooms.length, 0);
    });
  });

  test('retries failed pending approval, role revocation, and organization-user deletion', async () => {
    await withTestDbLock(async () => {
      await seedAdminOrganization();

      await openpathDb.insert(openpathSchema.users).values([
        {
          id: 'pending_recon',
          email: 'pending_recon@example.com',
          name: 'Pending Recon',
          passwordHash: 'hashed',
          isActive: true,
          emailVerified: true,
        },
        {
          id: 'target_recon',
          email: 'target_recon@example.com',
          name: 'Target Recon',
          passwordHash: 'hashed',
          isActive: true,
          emailVerified: true,
        },
      ]);

      await db.insert(schema.cpUserStatus).values({
        userId: 'pending_recon',
        status: 'waiting',
        targetOrganizationId: 'org_recon',
      });

      const approveOperation = await getOrCreateMutationOperation({
        operationType: 'pending_users.approve_user',
        idempotencyKey: 'org_recon:pending_recon',
        organizationId: 'org_recon',
        userId: 'pending_recon',
        metadata: { role: 'teacher', approvedBy: 'admin_recon' },
      });

      await setMutationOperationProgress(approveOperation.id, {
        step: 'failed',
        status: 'failed',
        lastError: { message: 'sync failed' },
      });

      const approved = await retryOrganizationMutationOperation({
        organizationId: 'org_recon',
        operationId: approveOperation.id,
        actedBy: 'admin_recon',
      });

      assert.ok(approved);

      await db.insert(schema.cpMemberships).values({
        id: 'mem_target_recon',
        organizationId: 'org_recon',
        userId: 'target_recon',
        role: 'admin',
        invitedBy: 'admin_recon',
      });

      const revokeOperation = await getOrCreateMutationOperation({
        operationType: 'users.revoke_role',
        idempotencyKey: 'org_recon:target_recon',
        organizationId: 'org_recon',
        userId: 'target_recon',
        metadata: { actedBy: 'admin_recon' },
      });

      await setMutationOperationProgress(revokeOperation.id, {
        step: 'failed',
        status: 'failed',
        result: { success: true },
        lastError: { message: 'sync failed' },
      });

      const revoked = await retryOrganizationMutationOperation({
        organizationId: 'org_recon',
        operationId: revokeOperation.id,
        actedBy: 'admin_recon',
      });

      assert.deepStrictEqual(revoked, { success: true });

      await db.insert(schema.cpOrganizationUsers).values({
        id: 'org_user_target_recon',
        organizationId: 'org_recon',
        openpathUserId: 'target_recon',
        email: 'target_recon@example.com',
        fullName: 'Target Recon',
        role: 'teacher',
      });

      const deleteOperation = await getOrCreateMutationOperation({
        operationType: 'users.delete_organization_user',
        idempotencyKey: 'org_recon:target_recon',
        organizationId: 'org_recon',
        userId: 'target_recon',
        metadata: { actedBy: 'admin_recon' },
      });

      await setMutationOperationProgress(deleteOperation.id, {
        step: 'failed',
        status: 'failed',
        result: { success: true, role: 'teacher' },
        lastError: { message: 'delete failed' },
      });

      const deleted = await retryOrganizationMutationOperation({
        organizationId: 'org_recon',
        operationId: deleteOperation.id,
        actedBy: 'admin_recon',
      });

      assert.deepStrictEqual(deleted, { success: true });
    });
  });

  test('retries failed group and classroom creation operations', async () => {
    await withTestDbLock(async () => {
      await seedAdminOrganization();

      const createGroupOperation = await getOrCreateMutationOperation({
        operationType: 'groups.create_group',
        idempotencyKey: 'org_recon:group-create-recon',
        organizationId: 'org_recon',
        userId: 'admin_recon',
        metadata: {
          actorRole: 'admin',
          displayName: 'Create Recon Group',
          enabled: 1,
          publicName: 'group-create-recon',
          rules: [],
          visibility: 'private',
        },
      });

      const createdGroup = await retryOrganizationMutationOperation({
        organizationId: 'org_recon',
        operationId: createGroupOperation.id,
        actedBy: 'admin_recon',
      });

      assert.ok(createdGroup);

      const createClassroomOperation = await getOrCreateMutationOperation({
        operationType: 'classrooms.create_classroom',
        idempotencyKey: 'org_recon:classroom-create-recon',
        organizationId: 'org_recon',
        userId: 'admin_recon',
        metadata: {
          defaultGroupId: null,
          displayName: 'Create Recon Classroom',
          publicName: 'classroom-create-recon',
        },
      });

      const createdClassroom = await retryOrganizationMutationOperation({
        organizationId: 'org_recon',
        operationId: createClassroomOperation.id,
        actedBy: 'admin_recon',
      });

      assert.ok(createdClassroom);
    });
  });
});
