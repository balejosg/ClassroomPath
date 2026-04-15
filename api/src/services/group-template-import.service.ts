import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { createOrganizationGroupFromRules } from './group-write.service.js';

type TemplateRule = typeof schema.cpGroupTemplateRules.$inferSelect;

export async function importTemplateIntoOrganization(params: {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  templateId: string;
  name?: string;
  displayName?: string;
}): Promise<{ id: string; name: string }> {
  const template = await db
    .select()
    .from(schema.cpGroupTemplates)
    .where(eq(schema.cpGroupTemplates.id, params.templateId))
    .limit(1);

  if (!template[0]) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
  }

  const templateRules: TemplateRule[] = await db
    .select()
    .from(schema.cpGroupTemplateRules)
    .where(eq(schema.cpGroupTemplateRules.templateId, template[0].id));

  const publicName = params.name?.trim() || `${template[0].name}-import`;
  const displayName = params.displayName?.trim() || template[0].displayName;

  const { group, publicName: createdPublicName } = await createOrganizationGroupFromRules({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    publicName,
    displayName,
    rules: templateRules.map((r) => ({ type: r.type, value: r.value, comment: r.comment })),
  });

  return { id: group.id, name: createdPublicName };
}
