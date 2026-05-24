import type { MutationOperationRecord } from '../cross-system-mutations.js';

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

export type OrganizationMutationCatalogEntry = {
  buildFacts: (mutation: OrganizationBusinessMutation) => OrganizationMutationOperationFacts;
  family: OrganizationMutationWorkflowFamily;
};
