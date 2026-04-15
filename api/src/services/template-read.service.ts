import { TRPCError } from '@trpc/server';
import { asc, desc, eq, ilike, or, sql, and } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { presentTemplate, presentTemplateRule } from './presenters.js';

export function buildTemplateRuleWhere(params: {
  templateId: string;
  type?: 'whitelist' | 'blocked_subdomain' | 'blocked_path';
  search?: string;
}) {
  const conditions = [eq(schema.cpGroupTemplateRules.templateId, params.templateId)];

  if (params.type) {
    conditions.push(eq(schema.cpGroupTemplateRules.type, params.type));
  }

  const search = params.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(schema.cpGroupTemplateRules.value, pattern),
        ilike(schema.cpGroupTemplateRules.comment, pattern)
      )!
    );
  }

  return and(...conditions);
}

export async function listTemplates() {
  const templates = await db
    .select({
      id: schema.cpGroupTemplates.id,
      name: schema.cpGroupTemplates.name,
      displayName: schema.cpGroupTemplates.displayName,
      description: schema.cpGroupTemplates.description,
      createdBy: schema.cpGroupTemplates.createdBy,
      createdAt: schema.cpGroupTemplates.createdAt,
      updatedAt: schema.cpGroupTemplates.updatedAt,
      ruleCount: sql<number>`cast(count(${schema.cpGroupTemplateRules.id}) as int)`,
    })
    .from(schema.cpGroupTemplates)
    .leftJoin(
      schema.cpGroupTemplateRules,
      eq(schema.cpGroupTemplateRules.templateId, schema.cpGroupTemplates.id)
    )
    .groupBy(
      schema.cpGroupTemplates.id,
      schema.cpGroupTemplates.name,
      schema.cpGroupTemplates.displayName,
      schema.cpGroupTemplates.description,
      schema.cpGroupTemplates.createdBy,
      schema.cpGroupTemplates.createdAt,
      schema.cpGroupTemplates.updatedAt
    )
    .orderBy(desc(schema.cpGroupTemplates.createdAt));

  return templates.map((template) => presentTemplate(template, Number(template.ruleCount) || 0));
}

export async function listTemplateRulesPaginated(params: {
  templateId: string;
  type?: 'whitelist' | 'blocked_subdomain' | 'blocked_path';
  limit: number;
  offset: number;
  search?: string;
}) {
  const [template] = await db
    .select({ id: schema.cpGroupTemplates.id })
    .from(schema.cpGroupTemplates)
    .where(eq(schema.cpGroupTemplates.id, params.templateId))
    .limit(1);

  if (!template) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
  }

  const whereConditions = buildTemplateRuleWhere(params);

  const [countRows, rules] = await Promise.all([
    db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.cpGroupTemplateRules)
      .where(whereConditions),
    db
      .select()
      .from(schema.cpGroupTemplateRules)
      .where(whereConditions)
      .orderBy(asc(schema.cpGroupTemplateRules.createdAt), asc(schema.cpGroupTemplateRules.id))
      .limit(params.limit)
      .offset(params.offset),
  ]);

  const total = Number(countRows[0]?.total ?? 0);

  return {
    rules: rules.map(presentTemplateRule),
    total,
    hasMore: params.offset + params.limit < total,
  };
}
