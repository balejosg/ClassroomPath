import type { SerializedWhitelistRule, WhitelistRuleType } from './group-rules-read.service.js';

const GROUP_PERMISSION_OPTS = {
  notAllowedMessage: 'Insufficient permissions for this group',
} as const;

export type TenantGroupRulesContext = {
  organizationId?: string;
  userRole?: string;
  user: { sub: string; name: string };
};

export type CreateRuleInput = {
  groupId: string;
  type: WhitelistRuleType;
  value: string;
  comment?: string;
};

export type BulkCreateRulesInput = {
  groupId: string;
  type: WhitelistRuleType;
  values: string[];
};

export type DeleteRuleInput = {
  id: string;
  groupId: string;
};

export type UpdateRuleInput = {
  id: string;
  groupId: string;
  value?: string;
  comment?: string | null;
};

type CreateRuleResult = SerializedWhitelistRule & { created: boolean };

export type TenantGroupRulesDependencies = {
  assertCanUseGroup: (
    ctx: TenantGroupRulesContext,
    groupId: string,
    options: typeof GROUP_PERMISSION_OPTS
  ) => Promise<void>;
  createOrReuseGroupRule: (input: CreateRuleInput) => Promise<CreateRuleResult>;
  bulkCreateGroupRules: (input: BulkCreateRulesInput) => Promise<number>;
  deleteGroupRule: (input: DeleteRuleInput) => Promise<boolean>;
  updateGroupRule: (
    input: UpdateRuleInput
  ) => Promise<{ rule: SerializedWhitelistRule; valueChanged: boolean }>;
};

export interface TenantGroupRules {
  createRule(ctx: TenantGroupRulesContext, input: CreateRuleInput): Promise<CreateRuleResult>;
  bulkCreateRules(
    ctx: TenantGroupRulesContext,
    input: BulkCreateRulesInput
  ): Promise<{ count: number }>;
  updateRule(
    ctx: TenantGroupRulesContext,
    input: UpdateRuleInput
  ): Promise<SerializedWhitelistRule>;
  deleteRule(ctx: TenantGroupRulesContext, input: DeleteRuleInput): Promise<{ success: true }>;
}

const defaultDependencies: TenantGroupRulesDependencies = {
  async assertCanUseGroup(ctx, groupId, options) {
    const { assertCanUseGroup } = await import('../lib/tenant-access.js');
    await assertCanUseGroup(ctx, groupId, options);
  },
  async createOrReuseGroupRule(input) {
    const { createOrReuseGroupRule } = await import('./group-rules-create.service.js');
    return createOrReuseGroupRule(input);
  },
  async bulkCreateGroupRules(input) {
    const { bulkCreateGroupRules } = await import('./group-rules-create.service.js');
    return bulkCreateGroupRules(input);
  },
  async deleteGroupRule(input) {
    const { deleteGroupRule } = await import('./group-rules-update.service.js');
    return deleteGroupRule(input);
  },
  async updateGroupRule(input) {
    const { updateGroupRule } = await import('./group-rules-update.service.js');
    return updateGroupRule(input);
  },
};

export function createTenantGroupRules(
  dependencies: TenantGroupRulesDependencies = defaultDependencies
): TenantGroupRules {
  return {
    async createRule(ctx, input) {
      await dependencies.assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      // Publish is performed by the repository write itself (whitelist-rules.repo).
      return dependencies.createOrReuseGroupRule(input);
    },

    async bulkCreateRules(ctx, input) {
      await dependencies.assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      const insertedCount = await dependencies.bulkCreateGroupRules(input);
      return { count: insertedCount };
    },

    async updateRule(ctx, input) {
      await dependencies.assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      const { rule } = await dependencies.updateGroupRule(input);
      return rule;
    },

    async deleteRule(ctx, input) {
      await dependencies.assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      await dependencies.deleteGroupRule(input);
      return { success: true };
    },
  };
}

export const tenantGroupRules = createTenantGroupRules();
