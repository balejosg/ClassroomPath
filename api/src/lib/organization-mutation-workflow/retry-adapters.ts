import { approveUser } from '../../services/pending-users.service.js';
import {
  assignOrganizationUserRole,
  deleteOrganizationUser,
  revokeOrganizationUserRole,
} from '../../services/user.service.js';
import {
  createOrganizationGroupFromRules,
  deleteOrganizationGroup,
} from '../../services/group-write.service.js';
import {
  createClassroomForTenant,
  deleteClassroomForTenant,
} from '../../services/classrooms/classroom-write.service.js';
import type {
  GroupRuleRecord,
  OrganizationMutationOperationType,
  OrganizationMutationRetryHandler,
  OrganizationRole,
} from './types.js';

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readOrganizationRole(value: unknown, fallback: OrganizationRole): OrganizationRole {
  return value === 'admin' || value === 'teacher' ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readGroupRules(value: unknown): GroupRuleRecord[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (rule): rule is GroupRuleRecord =>
      typeof rule === 'object' &&
      rule !== null &&
      typeof (rule as { type?: unknown }).type === 'string' &&
      typeof (rule as { value?: unknown }).value === 'string' &&
      ((rule as { comment?: unknown }).comment === null ||
        typeof (rule as { comment?: unknown }).comment === 'string')
  );
}

export const organizationMutationRetryAdapters = {
  'pending_users.approve_user': ({ operation, organizationId, actedBy }) =>
    approveUser(
      operation.userId ?? '',
      organizationId,
      readOrganizationRole(operation.metadata.role, 'teacher'),
      actedBy
    ),
  'users.assign_role': ({ operation, organizationId, actedBy }) =>
    assignOrganizationUserRole({
      organizationId,
      userId: operation.userId ?? '',
      actedBy,
      role: readOrganizationRole(operation.metadata.role, 'teacher'),
      groupIds: readStringArray(operation.metadata.groupIds),
    }),
  'users.revoke_role': ({ operation, organizationId, actedBy }) =>
    revokeOrganizationUserRole({
      organizationId,
      userId: operation.userId ?? '',
      actedBy,
    }),
  'users.delete_organization_user': ({ operation, organizationId, actedBy }) =>
    deleteOrganizationUser({
      organizationId,
      userId: operation.userId ?? '',
      actedBy,
    }),
  'groups.create_group': ({ operation, organizationId, actedBy }) =>
    createOrganizationGroupFromRules({
      organizationId,
      actorUserId: actedBy,
      actorRole: 'admin',
      publicName: readString(operation.metadata.publicName),
      displayName: readString(
        operation.metadata.displayName,
        readString(operation.metadata.publicName)
      ),
      enabled: Number(operation.metadata.enabled ?? 1),
      visibility: readString(operation.metadata.visibility, 'private'),
      rules: readGroupRules(operation.metadata.rules),
    }),
  'groups.delete_group': async ({ operation, organizationId, actedBy }) =>
    deleteOrganizationGroup({
      organizationId,
      userId: actedBy,
      userRole: 'admin',
      groupId:
        readNullableString(operation.result.groupId) ?? readString(operation.metadata.groupId),
    }),
  'classrooms.create_classroom': ({ operation, organizationId, actedBy }) =>
    createClassroomForTenant({
      ctx: {
        organizationId,
        userRole: 'admin',
        user: { sub: actedBy },
      },
      input: {
        name: readString(operation.metadata.publicName),
        displayName: readString(
          operation.metadata.displayName,
          readString(operation.metadata.publicName)
        ),
        defaultGroupId:
          operation.metadata.defaultGroupId === null
            ? undefined
            : (readNullableString(operation.metadata.defaultGroupId) ?? undefined),
      },
    }),
  'classrooms.delete_classroom': async ({ operation, organizationId, actedBy }) => {
    await deleteClassroomForTenant({
      ctx: {
        organizationId,
        userRole: 'admin',
        user: { sub: actedBy },
      },
      classroomId:
        readNullableString(operation.result.classroomId) ??
        readString(operation.metadata.classroomId),
    });
    return { success: true };
  },
} as const satisfies Partial<
  Record<OrganizationMutationOperationType, OrganizationMutationRetryHandler>
>;
