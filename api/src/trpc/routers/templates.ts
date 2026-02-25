import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { router, tenantProcedure } from '../trpc.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import {
  assertOrgGroupAccess,
  isOrgAdmin,
  requireTeacherOrAdmin,
} from '../../lib/tenant-access.js';

import {
  importTemplateIntoOrganization,
  publishTemplateFromGroup,
} from '../../services/group-copy.service.js';

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

    const templates = await db
      .select()
      .from(schema.cpGroupTemplates)
      .orderBy(desc(schema.cpGroupTemplates.createdAt));

    if (templates.length === 0) return [];

    const templateIds = templates.map((t) => t.id);
    const allRules = await db
      .select({ templateId: schema.cpGroupTemplateRules.templateId })
      .from(schema.cpGroupTemplateRules)
      .where(inArray(schema.cpGroupTemplateRules.templateId, templateIds));

    const counts = new Map<string, number>();
    for (const r of allRules) {
      counts.set(r.templateId, (counts.get(r.templateId) ?? 0) + 1);
    }

    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      createdBy: t.createdBy,
      ruleCount: counts.get(t.id) ?? 0,
      createdAt: t.createdAt?.toISOString() ?? null,
      updatedAt: t.updatedAt?.toISOString() ?? null,
    }));
  }),

  listRulesPaginated: tenantProcedure
    .input(TemplateRulesPaginatedSchema)
    .query(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      const tpl = await db
        .select({ id: schema.cpGroupTemplates.id })
        .from(schema.cpGroupTemplates)
        .where(eq(schema.cpGroupTemplates.id, input.templateId))
        .limit(1);

      if (!tpl.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }

      const whereConditions = input.type
        ? and(
            eq(schema.cpGroupTemplateRules.templateId, input.templateId),
            eq(schema.cpGroupTemplateRules.type, input.type)
          )
        : eq(schema.cpGroupTemplateRules.templateId, input.templateId);

      const allRules = await db.select().from(schema.cpGroupTemplateRules).where(whereConditions);

      let filtered = allRules;
      if (input.search?.trim()) {
        const searchLower = input.search.toLowerCase().trim();
        filtered = allRules.filter(
          (r) =>
            r.value.toLowerCase().includes(searchLower) ||
            (r.comment && r.comment.toLowerCase().includes(searchLower))
        );
      }

      const total = filtered.length;
      const paginated = filtered.slice(input.offset, input.offset + input.limit);

      return {
        rules: paginated.map((r) => ({
          id: r.id,
          templateId: r.templateId,
          type: r.type,
          value: r.value,
          comment: r.comment,
          createdAt: r.createdAt?.toISOString() ?? null,
        })),
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),

  publishFromGroup: tenantProcedure
    .input(TemplatePublishSchema)
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      if (!isOrgAdmin(ctx)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
      }

      await assertOrgGroupAccess(ctx.organizationId!, input.groupId);

      return publishTemplateFromGroup({
        actorUserId: ctx.user.sub,
        groupId: input.groupId,
        name: input.name,
        displayName: input.displayName,
        description: input.description,
      });
    }),

  import: tenantProcedure.input(TemplateImportSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);

    return importTemplateIntoOrganization({
      organizationId: ctx.organizationId!,
      actorUserId: ctx.user.sub,
      actorRole: ctx.userRole,
      templateId: input.templateId,
      name: input.name,
      displayName: input.displayName,
    });
  }),
});
