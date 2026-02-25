import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import {
  openpathDb,
  publishWhitelistGroupChanged,
  roles,
  whitelistGroups,
  whitelistRules,
} from '../db/openpath.js';

type OpenPathWhitelistRule = typeof whitelistRules.$inferSelect;
type TemplateRule = typeof schema.cpGroupTemplateRules.$inferSelect;

export function sanitizeSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
}

export async function findAvailableName(params: {
  baseName: string;
  maxLength: number;
  fallbackPrefix: string;
  exists: (candidate: string) => Promise<boolean>;
}): Promise<string> {
  const safeBase = sanitizeSlug(params.baseName);
  const trimmedBase = safeBase.replace(/^-+/, '').replace(/-+$/, '');
  if (!trimmedBase) {
    return `${params.fallbackPrefix}-${nanoid(8)}`.slice(0, params.maxLength);
  }

  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const suffix = i === 0 ? '' : `-${String(i + 1)}`;
    const candidate = `${trimmedBase}${suffix}`.slice(0, params.maxLength);
    if (!(await params.exists(candidate))) return candidate;
  }

  return `${trimmedBase}-${nanoid(6)}`.slice(0, params.maxLength);
}

export async function findAvailableGroupName(baseName: string): Promise<string> {
  return findAvailableName({
    baseName,
    maxLength: 100,
    fallbackPrefix: 'group',
    exists: async (candidate) => {
      const rows = await openpathDb
        .select({ id: whitelistGroups.id })
        .from(whitelistGroups)
        .where(eq(whitelistGroups.name, candidate))
        .limit(1);
      return rows.length > 0;
    },
  });
}

export async function findAvailableTemplateName(baseName: string): Promise<string> {
  return findAvailableName({
    baseName,
    maxLength: 100,
    fallbackPrefix: 'template',
    exists: async (candidate) => {
      const rows = await db
        .select({ id: schema.cpGroupTemplates.id })
        .from(schema.cpGroupTemplates)
        .where(eq(schema.cpGroupTemplates.name, candidate))
        .limit(1);
      return rows.length > 0;
    },
  });
}

export async function addGroupToTeacherRole(params: {
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

async function copyRulesToNewGroup(params: {
  groupId: string;
  rules: Array<Pick<OpenPathWhitelistRule, 'type' | 'value' | 'comment'>>;
}): Promise<void> {
  if (params.rules.length === 0) return;
  await openpathDb.insert(whitelistRules).values(
    params.rules.map((r) => ({
      id: nanoid(),
      groupId: params.groupId,
      type: r.type,
      value: r.value,
      comment: r.comment,
    }))
  );
}

export async function cloneGroupIntoOrganization(params: {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  sourceGroupId: string;
  name?: string;
  displayName?: string;
}): Promise<{ id: string; name: string }> {
  const source = await openpathDb
    .select()
    .from(whitelistGroups)
    .where(eq(whitelistGroups.id, params.sourceGroupId))
    .limit(1);

  if (!source[0]) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });
  }

  const rawName = params.name?.trim() || `${source[0].name}-copy`;
  const name = await findAvailableGroupName(rawName);

  const rawDisplayName = params.displayName?.trim();
  const displayName = rawDisplayName || `${source[0].displayName || source[0].name} Copy`;

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

  const sourceRules = await openpathDb
    .select()
    .from(whitelistRules)
    .where(eq(whitelistRules.groupId, source[0].id));

  await copyRulesToNewGroup({ groupId: group.id, rules: sourceRules });

  await db.insert(schema.cpOrganizationGroups).values({
    id: nanoid(),
    organizationId: params.organizationId,
    groupId: group.id,
    visibility: 'private',
  });

  if (params.actorRole === 'teacher') {
    await addGroupToTeacherRole({
      userId: params.actorUserId,
      groupId: group.id,
      createdBy: params.actorUserId,
    });
  }

  await publishWhitelistGroupChanged(group.id);

  return { id: group.id, name: group.name };
}

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

  const rawName = params.name?.trim() || `${template[0].name}-import`;
  const name = await findAvailableGroupName(rawName);
  const displayName = params.displayName?.trim() || template[0].displayName;

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

  await copyRulesToNewGroup({
    groupId: group.id,
    rules: templateRules.map((r) => ({ type: r.type, value: r.value, comment: r.comment })),
  });

  await db.insert(schema.cpOrganizationGroups).values({
    id: nanoid(),
    organizationId: params.organizationId,
    groupId: group.id,
    visibility: 'private',
  });

  if (params.actorRole === 'teacher') {
    await addGroupToTeacherRole({
      userId: params.actorUserId,
      groupId: group.id,
      createdBy: params.actorUserId,
    });
  }

  await publishWhitelistGroupChanged(group.id);

  return { id: group.id, name: group.name };
}

export async function publishTemplateFromGroup(params: {
  actorUserId: string;
  groupId: string;
  name?: string;
  displayName?: string;
  description?: string;
}): Promise<{ id: string; name: string }> {
  const sourceGroup = await openpathDb
    .select()
    .from(whitelistGroups)
    .where(eq(whitelistGroups.id, params.groupId))
    .limit(1);

  if (!sourceGroup[0]) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });
  }

  const sourceRules: OpenPathWhitelistRule[] = await openpathDb
    .select()
    .from(whitelistRules)
    .where(eq(whitelistRules.groupId, params.groupId));

  const rawName = params.name?.trim() || `${sourceGroup[0].name}-template`;
  const name = await findAvailableTemplateName(rawName);
  const displayName = params.displayName?.trim() || sourceGroup[0].displayName;

  const templateId = nanoid();
  await db.insert(schema.cpGroupTemplates).values({
    id: templateId,
    name,
    displayName,
    description: params.description?.trim() || null,
    createdBy: params.actorUserId,
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

  return { id: templateId, name };
}
