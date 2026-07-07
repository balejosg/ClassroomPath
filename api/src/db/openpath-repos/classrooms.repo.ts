import { and, eq, inArray, sql } from 'drizzle-orm';

import { classrooms, machines, openpathDb } from '../openpath.js';
import { notifyOpenPathClassroomChanged } from './publish.js';

// Owning module for classrooms/machines writes. Mixed flavors, all preserving
// the pre-refactor pairings exactly (plan F5/F13):
// - createClassroom / updateClassroomFields are BARE: creates belong to the
//   ledger createUpstream step; the field-update notify is input-conditioned
//   and owned by classroom-update.service.
// - deleteClassroomById / deleteMachineFromClassroom now notify the classroom
//   after the delete, closing the F13(d) no-notify gap (agents were left
//   applying policy for a deleted classroom).
// - setActiveGroupAndNotify pairs write+notify (unconditional on success).
// - updateCaptivePortalDomainsIfSupported tolerates a missing column (42703)
//   for mixed-version shared DBs -- previously duplicated in two services.

export type ClassroomRow = typeof classrooms.$inferSelect;
export type NewClassroom = typeof classrooms.$inferInsert;
export type MachineRow = typeof machines.$inferSelect;

export async function createClassroom(values: NewClassroom): Promise<ClassroomRow> {
  const [created] = await openpathDb.insert(classrooms).values(values).returning();
  return created;
}

export async function getClassroomById(classroomId: string): Promise<ClassroomRow | undefined> {
  const rows = await openpathDb
    .select()
    .from(classrooms)
    .where(eq(classrooms.id, classroomId))
    .limit(1);
  return rows[0];
}

export async function updateClassroomFields(
  classroomId: string,
  set: Partial<NewClassroom>
): Promise<ClassroomRow | undefined> {
  const [updated] = await openpathDb
    .update(classrooms)
    .set(set)
    .where(eq(classrooms.id, classroomId))
    .returning();
  return updated;
}

export async function updateCaptivePortalDomainsIfSupported(
  classroomId: string,
  captivePortalDomains: string[]
): Promise<boolean> {
  try {
    await openpathDb
      .update(classrooms)
      .set({ captivePortalDomains })
      .where(eq(classrooms.id, classroomId));
    return true;
  } catch (err) {
    if (isMissingCaptivePortalDomainsColumnError(err)) {
      return false;
    }
    throw err;
  }
}

function isMissingCaptivePortalDomainsColumnError(err: unknown): boolean {
  const error = err as { code?: string; cause?: { code?: string } };
  return error.code === '42703' || error.cause?.code === '42703';
}

export async function setActiveGroupAndNotify(
  classroomId: string,
  groupId: string | null
): Promise<ClassroomRow | undefined> {
  const [updated] = await openpathDb
    .update(classrooms)
    .set({ activeGroupId: groupId })
    .where(eq(classrooms.id, classroomId))
    .returning();

  if (!updated) {
    return undefined;
  }

  await notifyOpenPathClassroomChanged(updated.id);
  return updated;
}

export async function deleteClassroomById(classroomId: string): Promise<void> {
  await openpathDb.delete(classrooms).where(eq(classrooms.id, classroomId));
  await notifyOpenPathClassroomChanged(classroomId);
}

export async function deleteMachineFromClassroom(
  machineId: string,
  classroomId: string
): Promise<void> {
  await openpathDb
    .delete(machines)
    .where(and(eq(machines.id, machineId), eq(machines.classroomId, classroomId)));
  await notifyOpenPathClassroomChanged(classroomId);
}

export async function getClassroomsByIds(classroomIds: readonly string[]): Promise<ClassroomRow[]> {
  if (classroomIds.length === 0) {
    return [];
  }
  return openpathDb
    .select()
    .from(classrooms)
    .where(inArray(classrooms.id, [...classroomIds]));
}

export async function getMachinesByClassroomId(classroomId: string): Promise<MachineRow[]> {
  return openpathDb.select().from(machines).where(eq(machines.classroomId, classroomId));
}

export async function getMachinesByClassroomIds(
  classroomIds: readonly string[]
): Promise<MachineRow[]> {
  if (classroomIds.length === 0) {
    return [];
  }
  return openpathDb
    .select()
    .from(machines)
    .where(inArray(machines.classroomId, [...classroomIds]));
}

export async function getCaptivePortalDomainsByIds(
  classroomIds: readonly string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (classroomIds.length === 0) {
    return map;
  }

  try {
    const ids = sql.join(
      classroomIds.map((id) => sql`${id}`),
      sql`, `
    );
    const result = await openpathDb.execute<{
      id: string;
      captive_portal_domains: string[] | null;
    }>(sql`
      SELECT id, captive_portal_domains
      FROM classrooms
      WHERE id IN (${ids})
    `);
    for (const row of result.rows) {
      map.set(row.id, row.captive_portal_domains ?? []);
    }
    return map;
  } catch (err) {
    if (isMissingCaptivePortalDomainsColumnError(err)) {
      return map;
    }
    throw err;
  }
}

export async function getMachineClassroomLink(
  machineId: string
): Promise<{ id: string; classroomId: string | null } | undefined> {
  const machineRow = await openpathDb
    .select({ id: machines.id, classroomId: machines.classroomId })
    .from(machines)
    .where(eq(machines.id, machineId))
    .limit(1);
  return machineRow[0];
}
