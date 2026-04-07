export type RuleCounts = {
  whitelistCount: number;
  blockedSubdomainCount: number;
  blockedPathCount: number;
};

export const EMPTY_RULE_COUNTS: RuleCounts = {
  whitelistCount: 0,
  blockedSubdomainCount: 0,
  blockedPathCount: 0,
};

export type RoleInfo = {
  role: string;
  groupIds: string[];
};

export type TenantGroupPresenterSource = {
  id: string;
  name: string;
  displayName: string | null;
  enabled: number | boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type TenantUserPresenterSource = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type TenantRolePresenterSource = {
  id: string;
  userId: string;
  role: string;
  groupIds: unknown;
  createdBy: string | null;
  createdAt: Date | null;
};

export type TemplatePresenterSource = {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  createdBy: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type TemplateRulePresenterSource = {
  id: string;
  templateId: string;
  type: string;
  value: string;
  comment: string | null;
  createdAt: Date | null;
};

export function toIsoStringOrNull(date: unknown): string | null {
  if (date instanceof Date) return date.toISOString();
  return null;
}

export function normalizeRoleGroupIds(groupIds: unknown): string[] {
  if (!Array.isArray(groupIds)) return [];
  return groupIds.filter((value): value is string => typeof value === 'string');
}

function isEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return false;
}

function presentGroupBase(params: {
  group: TenantGroupPresenterSource;
  name: string;
  enabled: number | boolean;
}) {
  return {
    id: params.group.id,
    name: params.name,
    displayName: params.group.displayName,
    enabled: params.enabled,
    createdAt: toIsoStringOrNull(params.group.createdAt),
    updatedAt: toIsoStringOrNull(params.group.updatedAt),
  };
}

export function presentTenantGroupSummary(params: {
  group: TenantGroupPresenterSource;
  publicName?: string;
  visibility?: string;
  counts?: RuleCounts;
}) {
  const counts = params.counts ?? EMPTY_RULE_COUNTS;

  return {
    ...presentGroupBase({
      group: params.group,
      name: params.publicName ?? params.group.name,
      enabled: isEnabled(params.group.enabled),
    }),
    visibility: params.visibility ?? 'private',
    whitelistCount: counts.whitelistCount,
    blockedSubdomainCount: counts.blockedSubdomainCount,
    blockedPathCount: counts.blockedPathCount,
  };
}

export function presentTenantGroupLookup(params: {
  group: TenantGroupPresenterSource;
  publicName?: string;
}) {
  return presentGroupBase({
    group: params.group,
    name: params.publicName ?? params.group.name,
    enabled: params.group.enabled,
  });
}

export function presentTenantGroupMutation(params: {
  group: TenantGroupPresenterSource;
  publicName?: string;
}) {
  return presentGroupBase({
    group: params.group,
    name: params.publicName ?? params.group.name,
    enabled: isEnabled(params.group.enabled),
  });
}

export function presentUserWithRoles(params: {
  user: TenantUserPresenterSource;
  roles: RoleInfo[];
  nowIso?: string;
}) {
  const nowIso = params.nowIso ?? new Date().toISOString();

  return {
    id: params.user.id,
    email: params.user.email,
    name: params.user.name,
    isActive: params.user.isActive,
    emailVerified: params.user.emailVerified,
    createdAt: toIsoStringOrNull(params.user.createdAt) ?? nowIso,
    updatedAt: toIsoStringOrNull(params.user.updatedAt) ?? nowIso,
    roles: params.roles,
  };
}

export function presentUserRole(params: {
  role: TenantRolePresenterSource | null | undefined;
  fallback: {
    userId: string;
    role: string;
    groupIds?: string[];
    createdBy?: string;
  };
}) {
  return {
    id: params.role?.id ?? '',
    userId: params.role?.userId ?? params.fallback.userId,
    role: params.role?.role ?? params.fallback.role,
    groupIds: normalizeRoleGroupIds(params.role?.groupIds ?? params.fallback.groupIds ?? []),
    createdBy: params.role?.createdBy ?? params.fallback.createdBy ?? '',
    createdAt: toIsoStringOrNull(params.role?.createdAt),
  };
}

export function presentTemplate(template: TemplatePresenterSource, ruleCount: number) {
  return {
    id: template.id,
    name: template.name,
    displayName: template.displayName,
    description: template.description,
    createdBy: template.createdBy,
    ruleCount,
    createdAt: toIsoStringOrNull(template.createdAt),
    updatedAt: toIsoStringOrNull(template.updatedAt),
  };
}

export function presentTemplateRule(rule: TemplateRulePresenterSource) {
  return {
    id: rule.id,
    templateId: rule.templateId,
    type: rule.type,
    value: rule.value,
    comment: rule.comment,
    createdAt: toIsoStringOrNull(rule.createdAt),
  };
}
