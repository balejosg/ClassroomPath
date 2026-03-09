import { z } from 'zod';
import { TRPCError } from '@trpc/server';

import { router, tenantProcedure } from '../trpc.js';
import {
  assertOrgGroupAccess,
  isOrgAdmin,
  requireTeacherOrAdmin,
} from '../../lib/tenant-access.js';
import { assertTenantProcedureContext } from '../tenant-procedure-helpers.js';
import {
  listTemplateRulesPaginated,
  listTemplates,
  importTemplateToOrganization,
  publishTemplateFromOrganizationGroup,
} from '../../services/template.service.js';

const TemplatePublishSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
});

const TemplateImportSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(255).optional(),
});

const TemplateRulesPaginatedSchema = z.object({
  templateId: z.string().min(1),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']).optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
});

export const templatesRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    requireTeacherOrAdmin(ctx);
    return listTemplates();
  }),

  listRulesPaginated: tenantProcedure
    .input(TemplateRulesPaginatedSchema)
    .query(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      return listTemplateRulesPaginated(input);
    }),

  publishFromGroup: tenantProcedure
    .input(TemplatePublishSchema)
    .mutation(async ({ ctx, input }) => {
      assertTenantProcedureContext(ctx);
      requireTeacherOrAdmin(ctx);
      if (!isOrgAdmin(ctx)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
      }

      await assertOrgGroupAccess(ctx.organizationId, input.groupId);

      return publishTemplateFromOrganizationGroup({
        actorUserId: ctx.user.sub,
        organizationId: ctx.organizationId,
        groupId: input.groupId,
        name: input.name,
        displayName: input.displayName,
        description: input.description,
      });
    }),

  import: tenantProcedure.input(TemplateImportSchema).mutation(async ({ ctx, input }) => {
    assertTenantProcedureContext(ctx);
    requireTeacherOrAdmin(ctx);
    return importTemplateToOrganization({
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.sub,
      actorRole: ctx.userRole,
      templateId: input.templateId,
      name: input.name,
      displayName: input.displayName,
    });
  }),
});
