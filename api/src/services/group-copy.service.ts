import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { sanitizeSlug } from '@openpath/shared/slug';

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

type RuleSeed = Pick<OpenPathWhitelistRule, 'type' | 'value' | 'comment'>;

function trimSlugEdges(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '');
}

function buildNameCandidate(params: { base: string; suffix: string; maxLength: number }): string {
  const maxBaseLength = Math.max(0, params.maxLength - params.suffix.length);
  const base = params.base.slice(0, maxBaseLength).replace(/-+$/, '');
  return `${base}${params.suffix}`;
}

function fallbackRandomName(params: { fallbackPrefix: string; maxLength: number }): string {
  return `${params.fallbackPrefix}-${nanoid(8)}`.slice(0, params.maxLength);
}

export async function findAvailableName(params: {
  baseName: string;
  maxLength: number;
  fallbackPrefix: string;
  exists: (candidate: string) => Promise<boolean>;
}): Promise<string> {
  const safeBase = sanitizeSlug(params.baseName);
  const trimmedBase = trimSlugEdges(safeBase);
  if (!trimmedBase) {
    return fallbackRandomName({
      fallbackPrefix: params.fallbackPrefix,
      maxLength: params.maxLength,
    });
  }

  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const suffix = i === 0 ? '' : `-${String(i + 1)}`;
    const candidate = buildNameCandidate({
      base: trimmedBase,
      suffix,
      maxLength: params.maxLength,
    });
    if (!candidate || candidate.startsWith('-')) {
      return fallbackRandomName({
        fallbackPrefix: params.fallbackPrefix,
        maxLength: params.maxLength,
      });
    }
    if (!(await params.exists(candidate))) return candidate;
  }

  const fallback = buildNameCandidate({
    base: trimmedBase,
    suffix: `-${nanoid(6)}`,
    maxLength: params.maxLength,
  });
  return (
    fallback ||
    fallbackRandomName({ fallbackPrefix: params.fallbackPrefix, maxLength: params.maxLength })
  );
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

async function deleteOpenPathGroupCascade(groupId: string): Promise<void> {
  await openpathDb.delete(whitelistRules).where(eq(whitelistRules.groupId, groupId));
  await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, groupId));
}

async function createOrgGroupFromRules(params: {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  rawName: string;
  displayName: string;
  rules: RuleSeed[];
}): Promise<{ id: string; name: string }> {
  const name = await findAvailableGroupName(params.rawName);
  const groupId = nanoid();

  const group = await openpathDb.transaction(async (tx) => {
    const [created] = await tx
      .insert(whitelistGroups)
      .values({
        id: groupId,
        name,
        displayName: params.displayName,
        enabled: 1,
      })
      .returning();

    if (params.rules.length > 0) {
      await tx.insert(whitelistRules).values(
        params.rules.map((r) => ({
          id: nanoid(),
          groupId: created.id,
          type: r.type,
          value: r.value,
          comment: r.comment,
        }))
      );
    }

    return created;
  });

  try {
    await db.insert(schema.cpOrganizationGroups).values({
      id: nanoid(),
      organizationId: params.organizationId,
      groupId: group.id,
      visibility: 'private',
    });
  } catch (err) {
    try {
      await deleteOpenPathGroupCascade(group.id);
    } catch {
      // Best-effort rollback.
    }
    throw err;
  }

  if (params.actorRole === 'teacher') {
    try {
      await addGroupToTeacherRole({
        userId: params.actorUserId,
        groupId: group.id,
        createdBy: params.actorUserId,
      });
    } catch (err) {
      try {
        await db
          .delete(schema.cpOrganizationGroups)
          .where(
            and(
              eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
              eq(schema.cpOrganizationGroups.groupId, group.id)
            )
          );
      } catch {
        // Best-effort rollback.
      }

      try {
        await deleteOpenPathGroupCascade(group.id);
      } catch {
        // Best-effort rollback.
      }

      throw err;
    }
  }

  await publishWhitelistGroupChanged(group.id);

  return { id: group.id, name: group.name };
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

  const rawName = params.name?.trim() || `${source[0].name}-copia`;
  const name = await findAvailableGroupName(rawName);

  const rawDisplayName = params.displayName?.trim();
  const displayName = rawDisplayName || `${source[0].displayName || source[0].name} Copia`;

  const sourceRules: RuleSeed[] = await openpathDb
    .select({
      type: whitelistRules.type,
      value: whitelistRules.value,
      comment: whitelistRules.comment,
    })
    .from(whitelistRules)
    .where(eq(whitelistRules.groupId, source[0].id));

  return await createOrgGroupFromRules({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    rawName,
    displayName,
    rules: sourceRules,
  });
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
  const displayName = params.displayName?.trim() || template[0].displayName;

  return await createOrgGroupFromRules({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    rawName,
    displayName,
    rules: templateRules.map((r) => ({ type: r.type, value: r.value, comment: r.comment })),
  });
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

  await db.transaction(async (tx) => {
    await tx.insert(schema.cpGroupTemplates).values({
      id: templateId,
      name,
      displayName,
      description: params.description?.trim() || null,
      createdBy: params.actorUserId,
      updatedAt: new Date(),
    });

    if (sourceRules.length > 0) {
      await tx.insert(schema.cpGroupTemplateRules).values(
        sourceRules.map((r) => ({
          id: nanoid(),
          templateId,
          type: r.type,
          value: r.value,
          comment: r.comment,
        }))
      );
    }
  });

  return { id: templateId, name };
}
