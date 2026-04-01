import { TRPCError } from '@trpc/server';

import type { CrossSystemMutationStatus } from '../lib/cross-system-mutations.js';
import { listMutationOperations } from '../lib/cross-system-mutations.js';
import { approveUser } from './pending-users.service.js';
import {
  assignOrganizationUserRole,
  deleteOrganizationUser,
  revokeOrganizationUserRole,
} from './user.service.js';
import {
  createOrganizationGroupFromRules,
  deleteOrganizationGroup,
} from './group-write.service.js';
import {
  createClassroomForTenant,
  deleteClassroomForTenant,
} from './classrooms/classroom-write.service.js';

export async function listOrganizationMutationOperations(params: {
  organizationId: string;
  status?: CrossSystemMutationStatus;
}) {
  const operations = await listMutationOperations({
    organizationId: params.organizationId,
    status: params.status,
  });

  return operations.map((operation) => ({
    id: operation.id,
    operationType: operation.operationType,
    status: operation.status,
    currentStep: operation.currentStep,
    organizationId: operation.organizationId,
    userId: operation.userId,
    metadata: operation.metadata,
    result: operation.result,
    lastError: operation.lastError,
  }));
}

export async function retryOrganizationMutationOperation(params: {
  organizationId: string;
  operationId: string;
  actedBy: string;
}) {
  const [operation] = (
    await listMutationOperations({ organizationId: params.organizationId })
  ).filter((item) => item.id === params.operationId);

  if (!operation) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Mutation operation not found' });
  }

  switch (operation.operationType) {
    case 'pending_users.approve_user':
      return approveUser(
        operation.userId ?? '',
        params.organizationId,
        String(operation.metadata.role) as 'admin' | 'teacher',
        params.actedBy
      );
    case 'users.assign_role':
      return assignOrganizationUserRole({
        organizationId: params.organizationId,
        userId: operation.userId ?? '',
        actedBy: params.actedBy,
        role: String(operation.metadata.role) as 'admin' | 'teacher',
        groupIds: Array.isArray(operation.metadata.groupIds)
          ? operation.metadata.groupIds.filter(
              (value): value is string => typeof value === 'string'
            )
          : [],
      });
    case 'users.revoke_role':
      return revokeOrganizationUserRole({
        organizationId: params.organizationId,
        userId: operation.userId ?? '',
        actedBy: params.actedBy,
      });
    case 'users.delete_organization_user':
      return deleteOrganizationUser({
        organizationId: params.organizationId,
        userId: operation.userId ?? '',
        actedBy: params.actedBy,
      });
    case 'groups.create_group':
      return createOrganizationGroupFromRules({
        organizationId: params.organizationId,
        actorUserId: params.actedBy,
        actorRole: 'admin',
        publicName: String(operation.metadata.publicName ?? ''),
        displayName: String(operation.metadata.displayName ?? operation.metadata.publicName ?? ''),
        enabled: Number(operation.metadata.enabled ?? 1),
        visibility: String(operation.metadata.visibility ?? 'private'),
        rules: Array.isArray(operation.metadata.rules)
          ? operation.metadata.rules.filter(
              (rule): rule is { type: string; value: string; comment: string | null } =>
                typeof rule === 'object' &&
                rule !== null &&
                typeof (rule as { type?: unknown }).type === 'string' &&
                typeof (rule as { value?: unknown }).value === 'string'
            )
          : [],
      });
    case 'groups.delete_group':
      return deleteOrganizationGroup({
        organizationId: params.organizationId,
        userId: params.actedBy,
        userRole: 'admin',
        groupId: String(operation.result.groupId ?? operation.metadata.groupId ?? ''),
      });
    case 'classrooms.create_classroom':
      return createClassroomForTenant({
        ctx: {
          organizationId: params.organizationId,
          userRole: 'admin',
          user: { sub: params.actedBy },
        },
        input: {
          name: String(operation.metadata.publicName ?? ''),
          displayName: String(
            operation.metadata.displayName ?? operation.metadata.publicName ?? ''
          ),
          defaultGroupId:
            operation.metadata.defaultGroupId === null
              ? undefined
              : (operation.metadata.defaultGroupId as string | undefined),
        },
      });
    case 'classrooms.delete_classroom':
      await deleteClassroomForTenant({
        ctx: {
          organizationId: params.organizationId,
          userRole: 'admin',
          user: { sub: params.actedBy },
        },
        classroomId: String(operation.result.classroomId ?? operation.metadata.classroomId ?? ''),
      });
      return { success: true };
    default:
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Retry not supported for ${operation.operationType}`,
      });
  }
}
