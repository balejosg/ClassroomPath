import {
  getOrCreateMutationOperation,
  type MutationOperationRecord,
} from './cross-system-mutations.js';

export type OrganizationMutationWorkflowFamily = 'local-first' | 'upstream-first' | 'delete';

export type OrganizationMutationOperationType =
  | 'onboarding.create_organization'
  | 'pending_users.approve_user'
  | 'users.assign_role'
  | 'users.revoke_role'
  | 'users.delete_organization_user'
  | 'groups.create_group'
  | 'groups.delete_group'
  | 'classrooms.create_classroom'
  | 'classrooms.delete_classroom';

export type OrganizationRole = 'admin' | 'teacher';

export type GroupRuleRecord = {
  type: string;
  value: string;
  comment: string | null;
};

export type OrganizationBusinessMutation =
  | {
      kind: 'onboardingCreateOrganization';
      name: string;
      userId: string;
    }
  | {
      approvedBy: string;
      kind: 'pendingUserApproval';
      organizationId: string;
      role: OrganizationRole;
      userId: string;
    }
  | {
      actedBy: string;
      groupIds: string[];
      kind: 'userAssignRole';
      organizationId: string;
      role: OrganizationRole;
      userId: string;
    }
  | {
      actedBy: string;
      kind: 'userRevokeRole';
      organizationId: string;
      userId: string;
    }
  | {
      actedBy: string;
      kind: 'userDelete';
      organizationId: string;
      userId: string;
    }
  | {
      actorRole?: string;
      actorUserId: string;
      displayName: string;
      enabled: 0 | 1;
      kind: 'groupCreate';
      organizationId: string;
      publicName: string;
      rules: GroupRuleRecord[];
      visibility: string;
    }
  | {
      groupId: string;
      kind: 'groupDelete';
      organizationId: string;
      userId: string;
      userRole?: string;
    }
  | {
      defaultGroupId?: string | null;
      displayName: string;
      kind: 'classroomCreate';
      organizationId: string;
      publicName: string;
      userId: string;
    }
  | {
      classroomId: string;
      kind: 'classroomDelete';
      organizationId: string;
      userId: string;
    };

export type OrganizationMutationOperationFacts = {
  family: OrganizationMutationWorkflowFamily;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  operationType: OrganizationMutationOperationType;
  organizationId?: string;
  userId?: string;
};

const organizationMutationWorkflowFamilies = {
  'onboarding.create_organization': 'local-first',
  'pending_users.approve_user': 'local-first',
  'users.assign_role': 'local-first',
  'users.revoke_role': 'local-first',
  'users.delete_organization_user': 'local-first',
  'groups.create_group': 'upstream-first',
  'groups.delete_group': 'delete',
  'classrooms.create_classroom': 'upstream-first',
  'classrooms.delete_classroom': 'delete',
} as const satisfies Record<OrganizationMutationOperationType, OrganizationMutationWorkflowFamily>;

export function getOrganizationMutationWorkflowFamily(
  operationType: string
): OrganizationMutationWorkflowFamily | undefined {
  return organizationMutationWorkflowFamilies[operationType as OrganizationMutationOperationType];
}

export function buildOrganizationMutationOperation(
  mutation: OrganizationBusinessMutation
): OrganizationMutationOperationFacts {
  switch (mutation.kind) {
    case 'onboardingCreateOrganization':
      return {
        family: 'local-first',
        operationType: 'onboarding.create_organization',
        idempotencyKey: mutation.userId,
        userId: mutation.userId,
        metadata: { name: mutation.name },
      };
    case 'pendingUserApproval':
      return {
        family: 'local-first',
        operationType: 'pending_users.approve_user',
        idempotencyKey: `${mutation.organizationId}:${mutation.userId}`,
        organizationId: mutation.organizationId,
        userId: mutation.userId,
        metadata: { role: mutation.role, approvedBy: mutation.approvedBy },
      };
    case 'userAssignRole':
      return {
        family: 'local-first',
        operationType: 'users.assign_role',
        idempotencyKey: `${mutation.organizationId}:${mutation.userId}:${mutation.role}:${[
          ...mutation.groupIds,
        ]
          .sort()
          .join(',')}`,
        organizationId: mutation.organizationId,
        userId: mutation.userId,
        metadata: {
          actedBy: mutation.actedBy,
          role: mutation.role,
          groupIds: [...mutation.groupIds],
        },
      };
    case 'userRevokeRole':
      return {
        family: 'local-first',
        operationType: 'users.revoke_role',
        idempotencyKey: `${mutation.organizationId}:${mutation.userId}`,
        organizationId: mutation.organizationId,
        userId: mutation.userId,
        metadata: { actedBy: mutation.actedBy },
      };
    case 'userDelete':
      return {
        family: 'local-first',
        operationType: 'users.delete_organization_user',
        idempotencyKey: `${mutation.organizationId}:${mutation.userId}`,
        organizationId: mutation.organizationId,
        userId: mutation.userId,
        metadata: { actedBy: mutation.actedBy },
      };
    case 'groupCreate':
      return {
        family: 'upstream-first',
        operationType: 'groups.create_group',
        idempotencyKey: `${mutation.organizationId}:${mutation.publicName}`,
        organizationId: mutation.organizationId,
        userId: mutation.actorUserId,
        metadata: {
          actorRole: mutation.actorRole ?? null,
          displayName: mutation.displayName,
          enabled: mutation.enabled,
          publicName: mutation.publicName,
          rules: mutation.rules,
          visibility: mutation.visibility,
        },
      };
    case 'groupDelete':
      return {
        family: 'delete',
        operationType: 'groups.delete_group',
        idempotencyKey: `${mutation.organizationId}:${mutation.groupId}`,
        organizationId: mutation.organizationId,
        userId: mutation.userId,
        metadata: { groupId: mutation.groupId, userRole: mutation.userRole ?? null },
      };
    case 'classroomCreate':
      return {
        family: 'upstream-first',
        operationType: 'classrooms.create_classroom',
        idempotencyKey: `${mutation.organizationId}:${mutation.publicName}`,
        organizationId: mutation.organizationId,
        userId: mutation.userId,
        metadata: {
          defaultGroupId: mutation.defaultGroupId ?? null,
          displayName: mutation.displayName,
          publicName: mutation.publicName,
        },
      };
    case 'classroomDelete':
      return {
        family: 'delete',
        operationType: 'classrooms.delete_classroom',
        idempotencyKey: `${mutation.organizationId}:${mutation.classroomId}`,
        organizationId: mutation.organizationId,
        userId: mutation.userId,
        metadata: { classroomId: mutation.classroomId },
      };
  }
}

export async function getOrCreateOrganizationMutationOperation(
  mutation: OrganizationBusinessMutation
): Promise<MutationOperationRecord> {
  const facts = buildOrganizationMutationOperation(mutation);

  return getOrCreateMutationOperation({
    operationType: facts.operationType,
    idempotencyKey: facts.idempotencyKey,
    organizationId: facts.organizationId,
    userId: facts.userId,
    metadata: facts.metadata,
  });
}
