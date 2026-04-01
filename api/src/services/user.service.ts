import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, roles, users } from '../db/openpath.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { getSingleMembershipOrThrow } from '../lib/tenant-memberships.js';
import { normalizeRoleGroupIds, presentUserRole, presentUserWithRoles } from './presenters.js';
import {
  createOrganizationInvitation,
  listOrganizationInvitations,
  revokeOrganizationInvitation as revokeTenantInvitation,
} from './invitations.service.js';
import {
  recordUserDeletedAuditEvent,
  recordUserRoleAssignedAuditEvent,
  recordUserRoleRevokedAuditEvent,
} from './audit.service.js';
import {
  getMutationResult,
  getOrCreateMutationOperation,
  setMutationOperationProgress,
  toMutationError,
} from '../lib/cross-system-mutations.js';
import {
  assertOrganizationUserAccess,
  getOrganizationUserIds,
  getRolesByUserId,
} from './organization-user-access.service.js';

type OrganizationUserParams = {
  organizationId: string;
  userId: string;
};

const LAST_ADMIN_CONFLICT_MESSAGE = 'Cannot remove the last admin from the organization';

async function presentOrganizationUserById(userId: string, nowIso?: string) {
  const [userRows, rolesByUserId] = await Promise.all([
    openpathDb.select().from(users).where(eq(users.id, userId)).limit(1),
    getRolesByUserId([userId]),
  ]);

  const user = userRows[0];
  if (!user) return null;

  return presentUserWithRoles({
    user,
    roles: rolesByUserId.get(user.id) ?? [],
    nowIso,
  });
}

async function getPersistedUserRole(userId: string) {
  const [role] = await openpathDb.select().from(roles).where(eq(roles.userId, userId)).limit(1);
  return role ?? null;
}

async function assertManagedOrganizationUser(params: OrganizationUserParams): Promise<void> {
  await assertOrganizationUserAccess(params);
  await getSingleMembershipOrThrow(params.userId);
}

async function assertOrganizationAdminSurvivability(params: {
  organizationId: string;
  userId: string;
  nextRole?: 'admin' | 'teacher' | null;
}): Promise<void> {
  const [membership] = await db
    .select()
    .from(schema.cpMemberships)
    .where(
      and(
        eq(schema.cpMemberships.organizationId, params.organizationId),
        eq(schema.cpMemberships.userId, params.userId)
      )
    )
    .limit(1);

  if (!membership || membership.role !== 'admin') {
    return;
  }

  if (params.nextRole === 'admin') {
    return;
  }

  const adminMemberships = await db
    .select({ userId: schema.cpMemberships.userId })
    .from(schema.cpMemberships)
    .where(
      and(
        eq(schema.cpMemberships.organizationId, params.organizationId),
        eq(schema.cpMemberships.role, 'admin')
      )
    );

  if (adminMemberships.length <= 1) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: LAST_ADMIN_CONFLICT_MESSAGE,
    });
  }
}

async function updateOrganizationMembershipRole(params: {
  organizationId: string;
  userId: string;
  role: 'admin' | 'teacher';
}) {
  await db
    .update(schema.cpMemberships)
    .set({ role: params.role })
    .where(
      and(
        eq(schema.cpMemberships.organizationId, params.organizationId),
        eq(schema.cpMemberships.userId, params.userId)
      )
    );
}

export async function listOrganizationUsers(organizationId: string) {
  const userIds = await getOrganizationUserIds({ organizationId });
  if (userIds.length === 0) return [];

  const [usersList, rolesByUserId] = await Promise.all([
    openpathDb.select().from(users).where(inArray(users.id, userIds)),
    getRolesByUserId(userIds),
  ]);
  const nowIso = new Date().toISOString();

  return usersList.map((user) =>
    presentUserWithRoles({
      user,
      roles: rolesByUserId.get(user.id) ?? [],
      nowIso,
    })
  );
}

export async function getOrganizationUserById(params: { organizationId: string; userId: string }) {
  await assertOrganizationUserAccess(params);
  return presentOrganizationUserById(params.userId);
}

export async function getOrganizationUserRole(params: { organizationId: string; userId: string }) {
  await assertOrganizationUserAccess(params);

  const role = await getPersistedUserRole(params.userId);

  if (!role) return null;

  return presentUserRole({
    role,
    fallback: {
      userId: params.userId,
      role: role.role,
      groupIds: normalizeRoleGroupIds(role.groupIds),
      createdBy: role.createdBy ?? undefined,
    },
  });
}

export async function createOrganizationUser(params: {
  organizationId: string;
  actedBy: string;
  email: string;
  name: string;
  role: 'admin' | 'teacher';
}) {
  return createOrganizationInvitation({
    organizationId: params.organizationId,
    invitedBy: params.actedBy,
    email: params.email,
    name: params.name,
    role: params.role,
  });
}

export { listOrganizationInvitations };

export async function revokeOrganizationInvitation(params: {
  organizationId: string;
  invitationId: string;
  actedBy: string;
}) {
  return revokeTenantInvitation(params);
}

export async function updateOrganizationUser(params: {
  organizationId: string;
  userId: string;
  name?: string;
  active?: boolean;
}) {
  await assertManagedOrganizationUser(params);

  const updateData: { name?: string; isActive?: boolean } = {};
  if (params.name !== undefined) updateData.name = params.name.trim();
  if (params.active !== undefined) updateData.isActive = params.active;

  const [updated] = await openpathDb
    .update(users)
    .set(updateData)
    .where(eq(users.id, params.userId))
    .returning();

  return (
    (await presentOrganizationUserById(updated.id)) ??
    presentUserWithRoles({
      user: updated,
      roles: [],
    })
  );
}

export async function deleteOrganizationUser(params: {
  organizationId: string;
  userId: string;
  actedBy: string;
}) {
  await assertOrganizationUserAccess(params);
  await assertOrganizationAdminSurvivability({
    organizationId: params.organizationId,
    userId: params.userId,
    nextRole: null,
  });

  const operation = await getOrCreateMutationOperation({
    operationType: 'users.delete_organization_user',
    idempotencyKey: `${params.organizationId}:${params.userId}`,
    organizationId: params.organizationId,
    userId: params.userId,
    metadata: { actedBy: params.actedBy },
  });

  const storedResult = getMutationResult<{ success: true; role: string | null }>(operation);
  let localResult = storedResult;

  if (operation.status === 'completed' && localResult) {
    return { success: true };
  }

  if (!localResult) {
    const [membership] = await db
      .select({ role: schema.cpMemberships.role })
      .from(schema.cpMemberships)
      .where(
        and(
          eq(schema.cpMemberships.organizationId, params.organizationId),
          eq(schema.cpMemberships.userId, params.userId)
        )
      )
      .limit(1);

    await db.transaction(async (tx) => {
      await tx
        .delete(schema.cpOrganizationUsers)
        .where(
          and(
            eq(schema.cpOrganizationUsers.organizationId, params.organizationId),
            eq(schema.cpOrganizationUsers.openpathUserId, params.userId)
          )
        );

      await tx
        .delete(schema.cpMemberships)
        .where(
          and(
            eq(schema.cpMemberships.organizationId, params.organizationId),
            eq(schema.cpMemberships.userId, params.userId)
          )
        );

      await setMutationOperationProgress(
        operation.id,
        {
          step: 'local_committed',
          status: 'in_progress',
          result: { success: true, role: membership?.role ?? null },
          lastError: null,
        },
        tx
      );
    });

    localResult = { success: true, role: membership?.role ?? null };
  }

  try {
    await synchronizeOpenPathRole({
      userId: params.userId,
      actedBy: params.actedBy,
    });

    await setMutationOperationProgress(operation.id, {
      step: 'synced_upstream',
      status: 'in_progress',
      result: localResult,
      lastError: null,
    });

    if (localResult.role) {
      await recordUserDeletedAuditEvent({
        organizationId: params.organizationId,
        actorUserId: params.actedBy,
        userId: params.userId,
        role: localResult.role,
      });
    }

    await setMutationOperationProgress(operation.id, {
      step: 'completed',
      status: 'completed',
      result: localResult,
      lastError: null,
      completed: true,
    });
  } catch (error) {
    await setMutationOperationProgress(operation.id, {
      step: 'failed',
      status: 'failed',
      result: localResult,
      lastError: toMutationError(error),
    });
    throw error;
  }

  return { success: true };
}

export async function assignOrganizationUserRole(params: {
  organizationId: string;
  userId: string;
  actedBy: string;
  role: 'admin' | 'teacher';
  groupIds: string[];
}) {
  await assertManagedOrganizationUser(params);
  await assertOrganizationAdminSurvivability({
    organizationId: params.organizationId,
    userId: params.userId,
    nextRole: params.role,
  });
  const operation = await getOrCreateMutationOperation({
    operationType: 'users.assign_role',
    idempotencyKey: `${params.organizationId}:${params.userId}:${params.role}:${[...params.groupIds].sort().join(',')}`,
    organizationId: params.organizationId,
    userId: params.userId,
    metadata: { actedBy: params.actedBy, role: params.role, groupIds: [...params.groupIds] },
  });

  const storedResult = getMutationResult<{
    role: 'admin' | 'teacher';
    groupIds: string[];
    createdBy: string;
  }>(operation);
  const localResult = storedResult ?? {
    role: params.role,
    groupIds: [...params.groupIds],
    createdBy: params.actedBy,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(schema.cpMemberships)
      .set({ role: params.role })
      .where(
        and(
          eq(schema.cpMemberships.organizationId, params.organizationId),
          eq(schema.cpMemberships.userId, params.userId)
        )
      );

    await setMutationOperationProgress(
      operation.id,
      {
        step: 'local_committed',
        status: 'in_progress',
        result: localResult,
        lastError: null,
      },
      tx
    );
  });

  try {
    const synchronizedRole = await synchronizeOpenPathRole({
      userId: params.userId,
      actedBy: params.actedBy,
      groupIds: localResult.groupIds,
    });

    if (!synchronizedRole) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to synchronize upstream role state',
      });
    }

    await setMutationOperationProgress(operation.id, {
      step: 'synced_upstream',
      status: 'in_progress',
      result: {
        role: synchronizedRole.role,
        groupIds: synchronizedRole.groupIds,
        createdBy: params.actedBy,
      },
      lastError: null,
    });

    const persistedRole = await getPersistedUserRole(params.userId);

    await recordUserRoleAssignedAuditEvent({
      organizationId: params.organizationId,
      actorUserId: params.actedBy,
      userId: params.userId,
      role: params.role,
      groupIds: [...localResult.groupIds],
    });

    await setMutationOperationProgress(operation.id, {
      step: 'completed',
      status: 'completed',
      result: {
        role: synchronizedRole.role,
        groupIds: synchronizedRole.groupIds,
        createdBy: params.actedBy,
      },
      lastError: null,
      completed: true,
    });

    return presentUserRole({
      role: persistedRole,
      fallback: {
        userId: params.userId,
        role: synchronizedRole.role,
        groupIds: synchronizedRole.groupIds,
        createdBy: params.actedBy,
      },
    });
  } catch (error) {
    await setMutationOperationProgress(operation.id, {
      step: 'failed',
      status: 'failed',
      result: localResult ?? undefined,
      lastError: toMutationError(error),
    });
    throw error;
  }
}

export async function revokeOrganizationUserRole(params: {
  organizationId: string;
  userId: string;
  actedBy: string;
}) {
  await assertManagedOrganizationUser(params);
  await assertOrganizationAdminSurvivability({
    organizationId: params.organizationId,
    userId: params.userId,
    nextRole: 'teacher',
  });
  const operation = await getOrCreateMutationOperation({
    operationType: 'users.revoke_role',
    idempotencyKey: `${params.organizationId}:${params.userId}`,
    organizationId: params.organizationId,
    userId: params.userId,
    metadata: { actedBy: params.actedBy },
  });

  if (operation.status !== 'completed') {
    if (Object.keys(operation.result).length === 0) {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.cpMemberships)
          .set({ role: 'teacher' })
          .where(
            and(
              eq(schema.cpMemberships.organizationId, params.organizationId),
              eq(schema.cpMemberships.userId, params.userId)
            )
          );

        await setMutationOperationProgress(
          operation.id,
          {
            step: 'local_committed',
            status: 'in_progress',
            result: { success: true },
            lastError: null,
          },
          tx
        );
      });
    }

    try {
      await synchronizeOpenPathRole({
        userId: params.userId,
        actedBy: params.actedBy,
        groupIds: [],
      });

      await recordUserRoleRevokedAuditEvent({
        organizationId: params.organizationId,
        actorUserId: params.actedBy,
        userId: params.userId,
        role: 'teacher',
        groupIds: [],
      });

      await setMutationOperationProgress(operation.id, {
        step: 'completed',
        status: 'completed',
        result: { success: true },
        lastError: null,
        completed: true,
      });
    } catch (error) {
      await setMutationOperationProgress(operation.id, {
        step: 'failed',
        status: 'failed',
        result: { success: true },
        lastError: toMutationError(error),
      });
      throw error;
    }
  }

  return { success: true };
}
