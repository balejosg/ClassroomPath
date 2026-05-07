import { z } from 'zod';
import { GroupVisibility as GroupVisibilitySchema } from '../../openpath/shared.js';

import { router, teacherOrAdminProcedure, tenantMemberProcedure } from '../trpc.js';
import { assertCanViewGroup } from '../../lib/tenant-access.js';
import { cloneGroupIntoOrganization } from '../../services/group-copy.service.js';
import {
  listGroupedGroupRules,
  listGroupRules,
  listPaginatedGroupRules,
} from '../../services/group-rules.service.js';
import { tenantGroupRules } from '../../services/tenant-group-rules.service.js';
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

const RuleSourceSchema = z.enum(['manual', 'auto_extension']);

const BulkCreateRulesSchema = z.object({
  groupId: z.string(),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']),
  values: z.array(z.string().min(1).max(500)),
});

const ListRulesPaginatedSchema = z.object({
  groupId: z.string(),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']).optional(),
  source: RuleSourceSchema.optional(),
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
  source: RuleSourceSchema.optional(),
  limit: z.number().min(1).max(50).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  search: z.string().optional(),
});

const GROUP_PERMISSION_OPTS = {
  notAllowedMessage: 'Insufficient permissions for this group',
} as const;

export const groupsRouter = router({
  list: teacherOrAdminProcedure.query(async ({ ctx }) => {
    return listOrganizationGroups({
      organizationId: ctx.organizationId,
      userId: ctx.user.sub,
      userRole: ctx.userRole,
    });
  }),

  libraryList: teacherOrAdminProcedure.query(async ({ ctx }) => {
    return listOrganizationLibraryGroups(ctx.organizationId);
  }),

  clone: tenantMemberProcedure.input(CloneGroupSchema).mutation(async ({ ctx, input }) => {
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

  stats: teacherOrAdminProcedure.query(async ({ ctx }) => {
    return getOrganizationGroupStats({
      organizationId: ctx.organizationId,
      userId: ctx.user.sub,
      userRole: ctx.userRole,
    });
  }),

  getById: tenantMemberProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.id, GROUP_PERMISSION_OPTS);
      return getOrganizationGroupById({
        organizationId: ctx.organizationId,
        groupId: input.id,
      });
    }),

  getRules: tenantMemberProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      return listGroupRules({ groupId: input.groupId });
    }),

  getByName: teacherOrAdminProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ ctx, input }) => {
      return getOrganizationGroupByName({
        organizationId: ctx.organizationId,
        userId: ctx.user.sub,
        userRole: ctx.userRole,
        name: input.name,
      });
    }),

  listRules: tenantMemberProcedure
    .input(
      z.object({
        groupId: z.string(),
        type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']).optional(),
        source: RuleSourceSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      return listGroupRules(input);
    }),

  listRulesPaginated: tenantMemberProcedure
    .input(ListRulesPaginatedSchema)
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      return listPaginatedGroupRules(input);
    }),

  listRulesGrouped: tenantMemberProcedure
    .input(ListRulesGroupedSchema)
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);
      return listGroupedGroupRules(input);
    }),

  bulkDeleteRules: teacherOrAdminProcedure
    .input(BulkDeleteRulesSchema)
    .mutation(async ({ ctx, input }) => {
      return bulkDeleteOrganizationGroupRules({
        organizationId: ctx.organizationId,
        userId: ctx.user.sub,
        userRole: ctx.userRole,
        ids: input.ids,
      });
    }),

  create: teacherOrAdminProcedure.input(CreateGroupSchema).mutation(async ({ ctx, input }) => {
    return createOrganizationGroup({
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.sub,
      actorRole: ctx.userRole,
      name: input.name,
      displayName: input.displayName,
      enabled: input.enabled,
    });
  }),

  update: tenantMemberProcedure.input(UpdateGroupSchema).mutation(async ({ ctx, input }) => {
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

  delete: tenantMemberProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return deleteOrganizationGroup({
        organizationId: ctx.organizationId,
        userId: ctx.user.sub,
        userRole: ctx.userRole,
        groupId: input.id,
      });
    }),

  addRule: tenantMemberProcedure.input(AddRuleSchema).mutation(async ({ ctx, input }) => {
    return tenantGroupRules.createRule(ctx, input);
  }),

  createRule: tenantMemberProcedure.input(AddRuleSchema).mutation(async ({ ctx, input }) => {
    return tenantGroupRules.createRule(ctx, input);
  }),

  bulkCreateRules: tenantMemberProcedure
    .input(BulkCreateRulesSchema)
    .mutation(async ({ ctx, input }) => {
      return tenantGroupRules.bulkCreateRules(ctx, input);
    }),

  deleteRule: tenantMemberProcedure
    .input(z.object({ id: z.string(), groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return tenantGroupRules.deleteRule(ctx, input);
    }),

  updateRule: tenantMemberProcedure
    .input(
      z.object({
        id: z.string().min(1),
        groupId: z.string().min(1),
        value: z.string().min(1).max(500).optional(),
        comment: z.string().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return tenantGroupRules.updateRule(ctx, input);
    }),

  revokeAutoApproval: tenantMemberProcedure
    .input(z.object({ id: z.string().min(1), groupId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return tenantGroupRules.revokeAutoApproval(ctx, input);
    }),

  systemStatus: teacherOrAdminProcedure.query(async ({ ctx }) => {
    return getOrganizationSystemStatus({
      organizationId: ctx.organizationId,
      userId: ctx.user.sub,
      userRole: ctx.userRole,
    });
  }),
});
