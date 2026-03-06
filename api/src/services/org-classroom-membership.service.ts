import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';

export async function getOrgClassroomIds(params: { organizationId: string }): Promise<string[]> {
  const rows = await db
    .select({ classroomId: schema.cpOrganizationClassrooms.classroomId })
    .from(schema.cpOrganizationClassrooms)
    .where(eq(schema.cpOrganizationClassrooms.organizationId, params.organizationId));

  return rows.map((row) => row.classroomId);
}

export async function orgHasClassroom(params: {
  organizationId: string;
  classroomId: string;
}): Promise<boolean> {
  const rows = await db
    .select({ id: schema.cpOrganizationClassrooms.id })
    .from(schema.cpOrganizationClassrooms)
    .where(
      and(
        eq(schema.cpOrganizationClassrooms.organizationId, params.organizationId),
        eq(schema.cpOrganizationClassrooms.classroomId, params.classroomId)
      )
    )
    .limit(1);

  return rows.length > 0;
}
