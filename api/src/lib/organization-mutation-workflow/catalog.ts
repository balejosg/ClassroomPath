import type {
  OrganizationBusinessMutation,
  OrganizationMutationCatalogEntry,
  OrganizationMutationOperationFacts,
  OrganizationMutationOperationType,
  OrganizationMutationWorkflowFamily,
} from './types.js';

function requireMutationKind<TKind extends OrganizationBusinessMutation['kind']>(
  mutation: OrganizationBusinessMutation,
  kind: TKind
): Extract<OrganizationBusinessMutation, { kind: TKind }> {
  if (mutation.kind !== kind) {
    throw new Error(`Expected ${kind} mutation, received ${mutation.kind}`);
  }

  return mutation as Extract<OrganizationBusinessMutation, { kind: TKind }>;
}

export const organizationMutationCatalog = {
  'onboarding.create_organization': {
    family: 'local-first',
    buildFacts: (mutation) => {
      const typed = requireMutationKind(mutation, 'onboardingCreateOrganization');
      return {
        family: 'local-first',
        operationType: 'onboarding.create_organization',
        idempotencyKey: typed.userId,
        userId: typed.userId,
        metadata: { name: typed.name },
      };
    },
  },
  'pending_users.approve_user': {
    family: 'local-first',
    buildFacts: (mutation) => {
      const typed = requireMutationKind(mutation, 'pendingUserApproval');
      return {
        family: 'local-first',
        operationType: 'pending_users.approve_user',
        idempotencyKey: `${typed.organizationId}:${typed.userId}`,
        organizationId: typed.organizationId,
        userId: typed.userId,
        metadata: { role: typed.role, approvedBy: typed.approvedBy },
      };
    },
  },
  'users.assign_role': {
    family: 'local-first',
    buildFacts: (mutation) => {
      const typed = requireMutationKind(mutation, 'userAssignRole');
      return {
        family: 'local-first',
        operationType: 'users.assign_role',
        idempotencyKey: `${typed.organizationId}:${typed.userId}:${typed.role}:${[...typed.groupIds]
          .sort()
          .join(',')}`,
        organizationId: typed.organizationId,
        userId: typed.userId,
        metadata: {
          actedBy: typed.actedBy,
          role: typed.role,
          groupIds: [...typed.groupIds],
        },
      };
    },
  },
  'users.revoke_role': {
    family: 'local-first',
    buildFacts: (mutation) => {
      const typed = requireMutationKind(mutation, 'userRevokeRole');
      return {
        family: 'local-first',
        operationType: 'users.revoke_role',
        idempotencyKey: `${typed.organizationId}:${typed.userId}`,
        organizationId: typed.organizationId,
        userId: typed.userId,
        metadata: { actedBy: typed.actedBy },
      };
    },
  },
  'users.delete_organization_user': {
    family: 'local-first',
    buildFacts: (mutation) => {
      const typed = requireMutationKind(mutation, 'userDelete');
      return {
        family: 'local-first',
        operationType: 'users.delete_organization_user',
        idempotencyKey: `${typed.organizationId}:${typed.userId}`,
        organizationId: typed.organizationId,
        userId: typed.userId,
        metadata: { actedBy: typed.actedBy },
      };
    },
  },
  'groups.create_group': {
    family: 'upstream-first',
    buildFacts: (mutation) => {
      const typed = requireMutationKind(mutation, 'groupCreate');
      return {
        family: 'upstream-first',
        operationType: 'groups.create_group',
        idempotencyKey: `${typed.organizationId}:${typed.publicName}`,
        organizationId: typed.organizationId,
        userId: typed.actorUserId,
        metadata: {
          actorRole: typed.actorRole ?? null,
          displayName: typed.displayName,
          enabled: typed.enabled,
          publicName: typed.publicName,
          rules: typed.rules,
          visibility: typed.visibility,
        },
      };
    },
  },
  'groups.delete_group': {
    family: 'delete',
    buildFacts: (mutation) => {
      const typed = requireMutationKind(mutation, 'groupDelete');
      return {
        family: 'delete',
        operationType: 'groups.delete_group',
        idempotencyKey: `${typed.organizationId}:${typed.groupId}`,
        organizationId: typed.organizationId,
        userId: typed.userId,
        metadata: { groupId: typed.groupId, userRole: typed.userRole ?? null },
      };
    },
  },
  'classrooms.create_classroom': {
    family: 'upstream-first',
    buildFacts: (mutation) => {
      const typed = requireMutationKind(mutation, 'classroomCreate');
      return {
        family: 'upstream-first',
        operationType: 'classrooms.create_classroom',
        idempotencyKey: `${typed.organizationId}:${typed.publicName}`,
        organizationId: typed.organizationId,
        userId: typed.userId,
        metadata: {
          defaultGroupId: typed.defaultGroupId ?? null,
          displayName: typed.displayName,
          publicName: typed.publicName,
        },
      };
    },
  },
  'classrooms.delete_classroom': {
    family: 'delete',
    buildFacts: (mutation) => {
      const typed = requireMutationKind(mutation, 'classroomDelete');
      return {
        family: 'delete',
        operationType: 'classrooms.delete_classroom',
        idempotencyKey: `${typed.organizationId}:${typed.classroomId}`,
        organizationId: typed.organizationId,
        userId: typed.userId,
        metadata: { classroomId: typed.classroomId },
      };
    },
  },
} as const satisfies Record<OrganizationMutationOperationType, OrganizationMutationCatalogEntry>;

const organizationMutationKinds = {
  onboardingCreateOrganization: 'onboarding.create_organization',
  pendingUserApproval: 'pending_users.approve_user',
  userAssignRole: 'users.assign_role',
  userRevokeRole: 'users.revoke_role',
  userDelete: 'users.delete_organization_user',
  groupCreate: 'groups.create_group',
  groupDelete: 'groups.delete_group',
  classroomCreate: 'classrooms.create_classroom',
  classroomDelete: 'classrooms.delete_classroom',
} as const satisfies Record<
  OrganizationBusinessMutation['kind'],
  OrganizationMutationOperationType
>;

export const organizationMutationOperationTypes = Object.keys(
  organizationMutationCatalog
) as OrganizationMutationOperationType[];

export function buildOrganizationMutationOperation(
  mutation: OrganizationBusinessMutation
): OrganizationMutationOperationFacts {
  return organizationMutationCatalog[organizationMutationKinds[mutation.kind]].buildFacts(mutation);
}

export function getOrganizationMutationWorkflowFamily(
  operationType: string
): OrganizationMutationWorkflowFamily | undefined {
  return organizationMutationCatalog[operationType as OrganizationMutationOperationType]?.family;
}
