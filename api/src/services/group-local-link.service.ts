import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { addGroupToTeacherRole } from './group-role-membership.service.js';

export async function linkOrganizationGroup(params: {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  groupId: string;
  publicName: string;
  visibility: string;
}) {
  const existingLink = await db
    .select({ id: schema.cpOrganizationGroups.id })
    .from(schema.cpOrganizationGroups)
    .where(
      and(
        eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
        eq(schema.cpOrganizationGroups.groupId, params.groupId)
      )
    )
    .limit(1);

  if (existingLink.length === 0) {
    await db.insert(schema.cpOrganizationGroups).values({
      id: nanoid(),
      organizationId: params.organizationId,
      groupId: params.groupId,
      publicName: params.publicName,
      visibility: params.visibility,
    });
  }

  if (params.actorRole === 'teacher') {
    await addGroupToTeacherRole({
      userId: params.actorUserId,
      groupId: params.groupId,
      createdBy: params.actorUserId,
    });
  }
}
