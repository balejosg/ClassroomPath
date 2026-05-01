import {
  getOrCreateMutationOperation,
  type MutationOperationRecord,
} from './cross-system-mutations.js';
import { approveUser } from '../services/pending-users.service.js';
import {
  assignOrganizationUserRole,
  deleteOrganizationUser,
  revokeOrganizationUserRole,
} from '../services/user.service.js';
import {
  createOrganizationGroupFromRules,
  deleteOrganizationGroup,
} from '../services/group-write.service.js';
import {
  createClassroomForTenant,
  deleteClassroomForTenant,
} from '../services/classrooms/classroom-write.service.js';

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

export type OrganizationMutationRetryContext = {
  operation: MutationOperationRecord;
  organizationId: string;
  actedBy: string;
};

export type OrganizationMutationRetryHandler = (
  context: OrganizationMutationRetryContext
) => Promise<unknown>;

type CatalogEntry = {
  buildFacts: (mutation: OrganizationBusinessMutation) => OrganizationMutationOperationFacts;
  family: OrganizationMutationWorkflowFamily;
  retry?: OrganizationMutationRetryHandler;
};

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
    retry: ({ operation, organizationId, actedBy }) =>
      approveUser(
        operation.userId ?? '',
        organizationId,
        readOrganizationRole(operation.metadata.role, 'teacher'),
        actedBy
      ),
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
    retry: ({ operation, organizationId, actedBy }) =>
      assignOrganizationUserRole({
        organizationId,
        userId: operation.userId ?? '',
        actedBy,
        role: readOrganizationRole(operation.metadata.role, 'teacher'),
        groupIds: readStringArray(operation.metadata.groupIds),
      }),
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
    retry: ({ operation, organizationId, actedBy }) =>
      revokeOrganizationUserRole({
        organizationId,
        userId: operation.userId ?? '',
        actedBy,
      }),
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
    retry: ({ operation, organizationId, actedBy }) =>
      deleteOrganizationUser({
        organizationId,
        userId: operation.userId ?? '',
        actedBy,
      }),
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
    retry: ({ operation, organizationId, actedBy }) =>
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
    retry: async ({ operation, organizationId, actedBy }) =>
      deleteOrganizationGroup({
        organizationId,
        userId: actedBy,
        userRole: 'admin',
        groupId:
          readNullableString(operation.result.groupId) ?? readString(operation.metadata.groupId),
      }),
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
    retry: ({ operation, organizationId, actedBy }) =>
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
    retry: async ({ operation, organizationId, actedBy }) => {
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
  },
} as const satisfies Record<OrganizationMutationOperationType, CatalogEntry>;

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

export const organizationMutationRetryHandlers = organizationMutationOperationTypes.reduce<
  Partial<Record<OrganizationMutationOperationType, OrganizationMutationRetryHandler>>
>((handlers, operationType) => {
  const entry: CatalogEntry = organizationMutationCatalog[operationType];

  if (entry.retry) {
    handlers[operationType] = entry.retry;
  }

  return handlers;
}, {});

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

export function getOrganizationMutationRetryHandler(
  operationType: string
): OrganizationMutationRetryHandler | undefined {
  return organizationMutationRetryHandlers[operationType as OrganizationMutationOperationType];
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
