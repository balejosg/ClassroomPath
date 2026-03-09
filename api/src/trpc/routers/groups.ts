import { z } from 'zod';
import { GroupVisibility as GroupVisibilitySchema } from '@openpath/shared';

import { router, tenantProcedure } from '../trpc.js';
import { publishWhitelistGroupChanged } from '../../db/openpath.js';
import { assertCanUseGroup, assertCanViewGroup } from '../../lib/tenant-access.js';
import {
  assertTeacherOrAdminTenantProcedureContext,
  assertTenantProcedureContext,
} from '../tenant-procedure-helpers.js';
import { cloneGroupIntoOrganization } from '../../services/group-copy.service.js';
import {
  bulkCreateGroupRules,
  createOrReuseGroupRule,
  deleteGroupRule,
  listGroupedGroupRules,
  listGroupRules,
  listPaginatedGroupRules,
  updateGroupRule,
} from '../../services/group-rules.service.js';
import {
  getOrganizationGroupById,
  getOrganizationGroupByName,
  getOrganizationGroupStats,
  getOrganizationSystemStatus,
  listOrganizationGroups,
  listOrganizationLibraryGroups,
} from '../../services/group-read.service.js';
import {
  bulkDeleteOrganizationGroupRules,
  createOrganizationGroup,
  deleteOrganizationGroup,
  updateOrganizationGroup,
} from '../../services/group-write.service.js';

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(255),
  enabled: z.number().min(0).max(1).default(1),
});

const CloneGroupSchema = z.object({
  sourceGroupId: z.string(),
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(255).optional(),
});

const UpdateGroupSchema = z.object({
  id: z.string(),
  displayName: z.string().min(1).max(255).optional(),
  enabled: z.union([z.number().min(0).max(1), z.boolean()]).optional(),
  visibility: GroupVisibilitySchema.optional(),
});

const AddRuleSchema = z.object({
  groupId: z.string(),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']),
  value: z.string().min(1).max(500),
  comment: z.string().optional(),
});

const BulkCreateRulesSchema = z.object({
  groupId: z.string(),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']),
  values: z.array(z.string().min(1).max(500)),
});

const ListRulesPaginatedSchema = z.object({
  groupId: z.string(),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']).optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
});

const BulkDeleteRulesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

const ListRulesGroupedSchema = z.object({
  groupId: z.string(),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']).optional(),
  limit: z.number().min(1).max(50).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  search: z.string().optional(),
});

type AddRuleInput = z.infer<typeof AddRuleSchema>;

const GROUP_PERMISSION_OPTS = {
  notAllowedMessage: 'Insufficient permissions for this group',
} as const;

async function createWhitelistRuleForGroup(
  ctx: { organizationId?: string; userRole?: string; user: { sub: string } },
  input: AddRuleInput
) {
  await assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
  const result = await createOrReuseGroupRule(input);
  if (result.created) {
    await publishWhitelistGroupChanged(input.groupId);
  }

  return result;
}

export const groupsRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    assertTeacherOrAdminTenantProcedureContext(ctx);
    return listOrganizationGroups({
      organizationId: ctx.organizationId,
      userId: ctx.user.sub,
      userRole: ctx.userRole,
    });
  }),

  libraryList: tenantProcedure.query(async ({ ctx }) => {
    assertTeacherOrAdminTenantProcedureContext(ctx);
    return listOrganizationLibraryGroups(ctx.organizationId);
  }),

  clone: tenantProcedure.input(CloneGroupSchema).mutation(async ({ ctx, input }) => {
    assertTenantProcedureContext(ctx);
    await assertCanViewGroup(ctx, input.sourceGroupId, GROUP_PERMISSION_OPTS);

    return cloneGroupIntoOrganization({
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.sub,
      actorRole: ctx.userRole,
      sourceGroupId: input.sourceGroupId,
      name: input.name,
      displayName: input.displayName,
    });
  }),

  stats: tenantProcedure.query(async ({ ctx }) => {
    assertTeacherOrAdminTenantProcedureContext(ctx);
    return getOrganizationGroupStats({
      organizationId: ctx.organizationId,
      userId: ctx.user.sub,
      userRole: ctx.userRole,
    });
  }),

  getById: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    assertTenantProcedureContext(ctx);
    await assertCanViewGroup(ctx, input.id, GROUP_PERMISSION_OPTS);
    return getOrganizationGroupById({
      organizationId: ctx.organizationId,
      groupId: input.id,
    });
  }),

  getRules: tenantProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      return listGroupRules({ groupId: input.groupId });
    }),

  getByName: tenantProcedure.input(z.object({ name: z.string() })).query(async ({ ctx, input }) => {
    assertTeacherOrAdminTenantProcedureContext(ctx);
    return getOrganizationGroupByName({
      organizationId: ctx.organizationId,
      userId: ctx.user.sub,
      userRole: ctx.userRole,
      name: input.name,
    });
  }),

  listRules: tenantProcedure
    .input(
      z.object({
        groupId: z.string(),
        type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      return listGroupRules(input);
    }),

  listRulesPaginated: tenantProcedure
    .input(ListRulesPaginatedSchema)
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      return listPaginatedGroupRules(input);
    }),

  listRulesGrouped: tenantProcedure.input(ListRulesGroupedSchema).query(async ({ ctx, input }) => {
    await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
    return listGroupedGroupRules(input);
  }),

  bulkDeleteRules: tenantProcedure.input(BulkDeleteRulesSchema).mutation(async ({ ctx, input }) => {
    assertTeacherOrAdminTenantProcedureContext(ctx);
    return bulkDeleteOrganizationGroupRules({
      organizationId: ctx.organizationId,
      userId: ctx.user.sub,
      userRole: ctx.userRole,
      ids: input.ids,
    });
  }),

  create: tenantProcedure.input(CreateGroupSchema).mutation(async ({ ctx, input }) => {
    assertTeacherOrAdminTenantProcedureContext(ctx);
    return createOrganizationGroup({
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.sub,
      actorRole: ctx.userRole,
      name: input.name,
      displayName: input.displayName,
      enabled: input.enabled,
    });
  }),

  update: tenantProcedure.input(UpdateGroupSchema).mutation(async ({ ctx, input }) => {
    assertTenantProcedureContext(ctx);
    return updateOrganizationGroup({
      organizationId: ctx.organizationId,
      userId: ctx.user.sub,
      userRole: ctx.userRole,
      groupId: input.id,
      displayName: input.displayName,
      enabled: input.enabled,
      visibility: input.visibility,
    });
  }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertTenantProcedureContext(ctx);
    return deleteOrganizationGroup({
      organizationId: ctx.organizationId,
      userId: ctx.user.sub,
      userRole: ctx.userRole,
      groupId: input.id,
    });
  }),

  addRule: tenantProcedure.input(AddRuleSchema).mutation(async ({ ctx, input }) => {
    return createWhitelistRuleForGroup(ctx, input);
  }),

  createRule: tenantProcedure.input(AddRuleSchema).mutation(async ({ ctx, input }) => {
    return createWhitelistRuleForGroup(ctx, input);
  }),

  bulkCreateRules: tenantProcedure.input(BulkCreateRulesSchema).mutation(async ({ ctx, input }) => {
    await assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);

    const insertedCount = await bulkCreateGroupRules(input);
    if (insertedCount > 0) {
      await publishWhitelistGroupChanged(input.groupId);
    }

    return { count: insertedCount };
  }),

  deleteRule: tenantProcedure
    .input(z.object({ id: z.string(), groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      const deleted = await deleteGroupRule(input);
      if (deleted) {
        await publishWhitelistGroupChanged(input.groupId);
      }

      return { success: true };
    }),

  updateRule: tenantProcedure
    .input(
      z.object({
        id: z.string().min(1),
        groupId: z.string().min(1),
        value: z.string().min(1).max(500).optional(),
        comment: z.string().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      const { rule, valueChanged } = await updateGroupRule(input);
      if (valueChanged) {
        await publishWhitelistGroupChanged(input.groupId);
      }

      return rule;
    }),

  systemStatus: tenantProcedure.query(async ({ ctx }) => {
    assertTeacherOrAdminTenantProcedureContext(ctx);
    return getOrganizationSystemStatus({
      organizationId: ctx.organizationId,
      userId: ctx.user.sub,
      userRole: ctx.userRole,
    });
  }),
});
