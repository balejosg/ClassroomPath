import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { router, tenantProcedure } from '../trpc.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import {
  openpathDb,
  publishWhitelistGroupChanged,
  roles,
  whitelistGroups,
  whitelistRules,
} from '../../db/openpath.js';
import {
  assertOrgGroupAccess,
  isOrgAdmin,
  requireTeacherOrAdmin,
} from '../../lib/tenant-access.js';

type OpenPathWhitelistRule = typeof whitelistRules.$inferSelect;

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

function sanitizeName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
}

async function findAvailableTemplateName(baseName: string): Promise<string> {
  const safeBase = sanitizeName(baseName);
  const trimmedBase = safeBase.replace(/^-+/, '').replace(/-+$/, '');
  if (!trimmedBase) {
    return `template-${nanoid(8)}`;
  }

  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const suffix = i === 0 ? '' : `-${String(i + 1)}`;
    const candidate = `${trimmedBase}${suffix}`.slice(0, 100);
    const exists = await db
      .select({ id: schema.cpGroupTemplates.id })
      .from(schema.cpGroupTemplates)
      .where(eq(schema.cpGroupTemplates.name, candidate))
      .limit(1);
    if (!exists.length) return candidate;
  }

  return `${trimmedBase}-${nanoid(6)}`.slice(0, 100);
}

async function findAvailableGroupName(baseName: string): Promise<string> {
  const safeBase = sanitizeName(baseName);
  const trimmedBase = safeBase.replace(/^-+/, '').replace(/-+$/, '');
  if (!trimmedBase) {
    return `group-${nanoid(8)}`;
  }

  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const suffix = i === 0 ? '' : `-${String(i + 1)}`;
    const candidate = `${trimmedBase}${suffix}`.slice(0, 100);
    const exists = await openpathDb
      .select({ id: whitelistGroups.id })
      .from(whitelistGroups)
      .where(eq(whitelistGroups.name, candidate))
      .limit(1);
    if (!exists.length) return candidate;
  }

  return `${trimmedBase}-${nanoid(6)}`.slice(0, 100);
}

async function addGroupToTeacherRole(params: {
  userId: string;
  groupId: string;
  createdBy: string;
}): Promise<void> {
  const existingRoles = await openpathDb
    .select()
    .from(roles)
    .where(eq(roles.userId, params.userId));
  const teacherRole = existingRoles.find((r) => r.role === 'teacher');

  if (!teacherRole) {
    await openpathDb.insert(roles).values({
      id: nanoid(),
      userId: params.userId,
      role: 'teacher',
      groupIds: [params.groupId],
      createdBy: params.createdBy,
    });
    return;
  }

  const current = Array.isArray(teacherRole.groupIds) ? teacherRole.groupIds : [];
  const next = [...new Set([...current, params.groupId])];
  await openpathDb
    .update(roles)
    .set({ groupIds: next as unknown as string[] })
    .where(eq(roles.id, teacherRole.id));
}

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

      const sourceGroup = await openpathDb
        .select()
        .from(whitelistGroups)
        .where(eq(whitelistGroups.id, input.groupId))
        .limit(1);

      if (!sourceGroup[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });
      }

      const sourceRules: OpenPathWhitelistRule[] = await openpathDb
        .select()
        .from(whitelistRules)
        .where(eq(whitelistRules.groupId, input.groupId));

      const rawName = input.name?.trim() || `${sourceGroup[0].name}-template`;
      const name = await findAvailableTemplateName(rawName);
      const displayName = input.displayName?.trim() || sourceGroup[0].displayName;

      const templateId = nanoid();
      await db.insert(schema.cpGroupTemplates).values({
        id: templateId,
        name,
        displayName,
        description: input.description?.trim() || null,
        createdBy: ctx.user.sub,
        updatedAt: new Date(),
      });

      if (sourceRules.length > 0) {
        await db.insert(schema.cpGroupTemplateRules).values(
          sourceRules.map((r) => ({
            id: nanoid(),
            templateId,
            type: r.type,
            value: r.value,
            comment: r.comment,
          }))
        );
      }

      return {
        id: templateId,
        name,
      };
    }),

  import: tenantProcedure.input(TemplateImportSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);

    const template = await db
      .select()
      .from(schema.cpGroupTemplates)
      .where(eq(schema.cpGroupTemplates.id, input.templateId))
      .limit(1);

    if (!template[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
    }

    const templateRules = await db
      .select()
      .from(schema.cpGroupTemplateRules)
      .where(eq(schema.cpGroupTemplateRules.templateId, template[0].id));

    const rawName = input.name?.trim() || `${template[0].name}-import`;
    const name = await findAvailableGroupName(rawName);
    const displayName = input.displayName?.trim() || template[0].displayName;

    const groupId = nanoid();
    const [group] = await openpathDb
      .insert(whitelistGroups)
      .values({
        id: groupId,
        name,
        displayName,
        enabled: 1,
      })
      .returning();

    if (templateRules.length > 0) {
      await openpathDb.insert(whitelistRules).values(
        templateRules.map((r) => ({
          id: nanoid(),
          groupId: group.id,
          type: r.type,
          value: r.value,
          comment: r.comment,
        }))
      );
    }

    await db.insert(schema.cpOrganizationGroups).values({
      id: nanoid(),
      organizationId: ctx.organizationId!,
      groupId: group.id,
      visibility: 'private',
    });

    if (ctx.userRole === 'teacher') {
      await addGroupToTeacherRole({
        userId: ctx.user.sub,
        groupId: group.id,
        createdBy: ctx.user.sub,
      });
    }

    await publishWhitelistGroupChanged(group.id);

    return {
      id: group.id,
      name: group.name,
    };
  }),
});
