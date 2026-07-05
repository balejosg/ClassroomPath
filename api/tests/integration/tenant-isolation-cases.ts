export interface TenantAResources {
  orgId: string;
  groupId: string;
  groupPublicName: string;
  ruleId: string;
  classroomId: string;
  machineId: string;
  scheduleId: string;
  oneOffScheduleId: string;
  exemptionId: string;
  requestId: string;
  pendingUserId: string;
  templateId: string;
  userId: string;
  userEmail: string;
  invitationId: string;
  operationId: string;
  pushEndpoint: string;
}

export type RejectCode = 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST';

export interface RejectCase {
  kind: 'reject';
  code: RejectCode;
  input: (a: TenantAResources) => unknown;
}

export interface ScopedCase {
  kind: 'scoped';
  mutation?: boolean;
  input: (a: TenantAResources) => unknown;
  note: string;
}

export type CrossTenantCase = RejectCase | ScopedCase;

const reject = (code: RejectCode, input: (a: TenantAResources) => unknown): RejectCase => ({
  kind: 'reject',
  code,
  input,
});

const scoped = (
  input: (a: TenantAResources) => unknown,
  note: string,
  mutation = false
): ScopedCase => ({ kind: 'scoped', input, note, mutation });

const FUTURE_ISO = new Date(Date.now() + 60 * 60 * 1000).toISOString();

export const CROSS_TENANT_CASES: Record<string, CrossTenantCase> = {
  // ---- groups ----
  'groups.list': scoped(() => undefined, 'org-scoped list: returns caller org groups only'),
  'groups.libraryList': scoped(() => undefined, 'org-scoped library list'),
  'groups.stats': scoped(() => undefined, 'org-scoped aggregate'),
  'groups.systemStatus': scoped(() => undefined, 'org-scoped aggregate'),
  'groups.getByName': scoped(
    (a) => ({ name: a.groupPublicName }),
    'name lookup scoped to caller org via cp_organization_groups; returns null cross-org'
  ),
  'groups.create': scoped(
    () => ({ name: 'tenant-b-new-group', displayName: 'Tenant B New Group', enabled: 1 }),
    'own-org create; must not touch tenant A',
    true
  ),
  'groups.clone': reject('NOT_FOUND', (a) => ({ sourceGroupId: a.groupId })),
  'groups.getById': reject('NOT_FOUND', (a) => ({ id: a.groupId })),
  'groups.getRules': reject('NOT_FOUND', (a) => ({ groupId: a.groupId })),
  'groups.listRules': reject('NOT_FOUND', (a) => ({ groupId: a.groupId })),
  'groups.listRulesPaginated': reject('NOT_FOUND', (a) => ({
    groupId: a.groupId,
    limit: 50,
    offset: 0,
  })),
  'groups.listRulesGrouped': reject('NOT_FOUND', (a) => ({
    groupId: a.groupId,
    limit: 20,
    offset: 0,
  })),
  'groups.update': reject('NOT_FOUND', (a) => ({ id: a.groupId, displayName: 'hijacked' })),
  'groups.delete': reject('NOT_FOUND', (a) => ({ id: a.groupId })),
  'groups.addRule': reject('NOT_FOUND', (a) => ({
    groupId: a.groupId,
    type: 'whitelist',
    value: 'evil.test',
  })),
  'groups.createRule': reject('NOT_FOUND', (a) => ({
    groupId: a.groupId,
    type: 'whitelist',
    value: 'evil.test',
  })),
  'groups.bulkCreateRules': reject('NOT_FOUND', (a) => ({
    groupId: a.groupId,
    type: 'whitelist',
    values: ['evil.test'],
  })),
  'groups.deleteRule': reject('NOT_FOUND', (a) => ({ id: a.ruleId, groupId: a.groupId })),
  'groups.updateRule': reject('NOT_FOUND', (a) => ({
    id: a.ruleId,
    groupId: a.groupId,
    value: 'evil.test',
  })),
  // bulkDeleteRules is teacherOrAdmin and filters by getAccessibleTenantGroupIds:
  // tenant A's rule is not in tenant B's accessible set -> FORBIDDEN, not NOT_FOUND.
  'groups.bulkDeleteRules': reject('FORBIDDEN', (a) => ({ ids: [a.ruleId] })),

  // ---- classrooms ----
  'classrooms.list': scoped(() => undefined, 'org-scoped list'),
  'classrooms.getById': reject('NOT_FOUND', (a) => ({ id: a.classroomId })),
  // listTenantClassroomMachines (classroom-machine-access.service.ts) resolves
  // the caller's own classroomIds first and short-circuits `return []` when
  // that set is empty -- it never reaches the specific-classroomId membership
  // check in that case. Verified empirically: tenant B (zero classrooms of its
  // own) gets 200 [] for ANY classroomId, real or garbage, so no tenant-A data
  // or existence oracle is disclosed. This is an org-scoped empty-result
  // no-op, not a leak -- registered as scoped like pendingUsers.reject.
  'classrooms.listMachines': scoped(
    (a) => ({ classroomId: a.classroomId }),
    'caller-org-scoped machine list; returns [] (not NOT_FOUND) when caller org owns zero classrooms, before the specific-classroomId check runs'
  ),
  'classrooms.listExemptions': reject('NOT_FOUND', (a) => ({ classroomId: a.classroomId })),
  'classrooms.createExemption': reject('NOT_FOUND', (a) => ({
    machineId: a.machineId,
    classroomId: a.classroomId,
    scheduleId: a.scheduleId,
  })),
  'classrooms.createOperationalExemption': reject('NOT_FOUND', (a) => ({
    machineId: a.machineId,
    classroomId: a.classroomId,
    durationHours: 1,
    reason: 'cross-tenant probe',
  })),
  'classrooms.deleteExemption': reject('NOT_FOUND', (a) => ({ id: a.exemptionId })),
  'classrooms.setActiveGroup': reject('NOT_FOUND', (a) => ({ id: a.classroomId, groupId: null })),
  'classrooms.deleteMachine': reject('NOT_FOUND', (a) => ({
    id: a.machineId,
    classroomId: a.classroomId,
  })),
  'classrooms.create': scoped(
    () => ({ name: 'tenant-b-new-classroom', displayName: 'Tenant B New Classroom' }),
    'own-org create',
    true
  ),
  'classrooms.update': reject('NOT_FOUND', (a) => ({ id: a.classroomId, displayName: 'hijacked' })),
  'classrooms.delete': reject('NOT_FOUND', (a) => ({ id: a.classroomId })),

  // ---- schedules ----
  'schedules.getMine': scoped(() => undefined, 'per-teacher list; returns caller schedules only'),
  'schedules.getByClassroom': reject('NOT_FOUND', (a) => ({ classroomId: a.classroomId })),
  'schedules.create': reject('NOT_FOUND', (a) => ({
    classroomId: a.classroomId,
    groupId: a.groupId,
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:00',
  })),
  'schedules.createOneOff': reject('NOT_FOUND', (a) => ({
    classroomId: a.classroomId,
    groupId: a.groupId,
    startAt: FUTURE_ISO,
    endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  })),
  // update loads the schedule, validates it is weekly (it is, so this passes),
  // then hits assertOrgClassroomAccess -> NOT_FOUND.
  'schedules.update': reject('NOT_FOUND', (a) => ({ id: a.scheduleId, dayOfWeek: 2 })),
  // updateOneOff loads the schedule and validates recurrence via
  // getOneOffScheduleBase BEFORE assertOrgClassroomAccess (see
  // schedule-oneoff-write.service.ts). Verified empirically: pointing this at
  // the weekly seed schedule trips "Schedule is not one-off" (BAD_REQUEST)
  // without ever reaching the tenant guard. Use a genuinely one-off schedule
  // so the case actually exercises cross-tenant isolation.
  'schedules.updateOneOff': reject('NOT_FOUND', (a) => ({
    id: a.oneOffScheduleId,
    startAt: FUTURE_ISO,
  })),
  'schedules.delete': reject('NOT_FOUND', (a) => ({ id: a.scheduleId })),

  // ---- templates (intentional GLOBAL shared catalog; see ADR 0003) ----
  'templates.list': scoped(() => undefined, 'templates are a global shared catalog by design'),
  'templates.listRulesPaginated': scoped(
    (a) => ({ templateId: a.templateId, limit: 50, offset: 0 }),
    'reads the global shared template catalog; not org-owned data'
  ),
  'templates.import': scoped(
    (a) => ({ templateId: a.templateId }),
    'importing a shared template copies rules into the CALLER org; tenant A unchanged',
    true
  ),
  'templates.publishFromGroup': reject('NOT_FOUND', (a) => ({ groupId: a.groupId })),

  // ---- users (organizationUserAdminProcedure) ----
  'users.list': scoped(() => undefined, 'org-scoped user list'),
  'users.listInvitations': scoped(() => undefined, 'org-scoped invitation list'),
  'users.listMutationOperations': scoped(() => undefined, 'org-scoped operations list'),
  'users.getById': reject('FORBIDDEN', (a) => ({ id: a.userId })),
  'users.getRole': reject('FORBIDDEN', (a) => ({ userId: a.userId })),
  'users.create': scoped(
    () => ({ email: 'tenant-b-new-user@test.local', name: 'Tenant B New User', role: 'teacher' }),
    'own-org user create',
    true
  ),
  'users.update': reject('FORBIDDEN', (a) => ({ id: a.userId, name: 'hijacked' })),
  'users.delete': reject('FORBIDDEN', (a) => ({ id: a.userId })),
  'users.revokeInvitation': reject('NOT_FOUND', (a) => ({ invitationId: a.invitationId })),
  'users.retryMutationOperation': reject('NOT_FOUND', (a) => ({ operationId: a.operationId })),
  'users.assignRole': reject('FORBIDDEN', (a) => ({
    userId: a.userId,
    role: 'teacher',
    groupIds: [],
  })),
  'users.revokeRole': reject('FORBIDDEN', (a) => ({ userId: a.userId })),

  // ---- requests ----
  'requests.listGroups': scoped(() => undefined, 'org-scoped accessible-group list'),
  'requests.stats': scoped(() => undefined, 'org-scoped aggregate'),
  'requests.list': scoped(() => ({ status: 'pending' }), 'org-scoped request list'),
  'requests.create': reject('FORBIDDEN', (a) => ({ domain: 'evil.test', groupId: a.groupId })),
  'requests.approve': reject('FORBIDDEN', (a) => ({ id: a.requestId })),
  'requests.reject': reject('FORBIDDEN', (a) => ({ id: a.requestId })),
  'requests.delete': reject('FORBIDDEN', (a) => ({ id: a.requestId })),

  // ---- pendingUsers (admin) ----
  'pendingUsers.list': scoped(() => undefined, 'org-scoped waiting-user list'),
  'pendingUsers.approve': reject('NOT_FOUND', (a) => ({
    userId: a.pendingUserId,
    role: 'teacher',
  })),
  // reject() the tRPC procedure is admin-guarded but the SERVICE silently no-ops
  // when the waiting row targets another org (DELETE ... WHERE target_org = B
  // affects 0 rows). This is a registered org-scoped no-op; Task 4 proves tenant
  // A's waiting row is untouched.
  'pendingUsers.reject': scoped(
    (a) => ({ userId: a.pendingUserId }),
    'cross-org reject is a no-op (0 rows); tenant A waiting row must be unchanged',
    true
  ),

  // ---- push ----
  'push.getStatus': scoped(() => undefined, 'per-user subscription status'),
  'push.subscribe': reject('FORBIDDEN', (a) => ({
    subscription: {
      endpoint: 'https://push.tenant-b.test/ep-b',
      keys: { p256dh: 'p256dh-b', auth: 'auth-b' },
    },
    groupIds: [a.groupId],
  })),
  'push.unsubscribe': scoped(
    (a) => ({ endpoint: a.pushEndpoint }),
    'unsubscribe is scoped to caller user.sub; deleting tenant A endpoint is a no-op',
    true
  ),

  // ---- auth (tenant-scoped recovery) ----
  'auth.generateResetToken': reject('FORBIDDEN', (a) => ({ email: a.userEmail })),
};
