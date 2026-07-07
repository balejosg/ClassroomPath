import { and, eq, sql } from 'drizzle-orm';

import { machineExemptions, openpathDb } from '../openpath.js';
import { notifyOpenPathClassroomChanged } from './publish.js';

// Owning module for machine_exemptions writes. Pairing (F5): every effective
// exemption change notifies the classroom the caller resolved. The schedule
// create keeps the exact partial-index conflict target + reuse-SELECT fallback
// from classroom-exemptions.service; notify fires only once a row exists (the
// service threw CONFLICT before notifying when no row could be produced).

export type MachineExemptionRow = typeof machineExemptions.$inferSelect;
export type NewMachineExemption = typeof machineExemptions.$inferInsert;

export async function createScheduleExemptionAndNotify(
  values: NewMachineExemption & { scheduleId: string }
): Promise<MachineExemptionRow | undefined> {
  const inserted = await openpathDb
    .insert(machineExemptions)
    .values(values)
    .onConflictDoNothing({
      target: [
        machineExemptions.machineId,
        machineExemptions.scheduleId,
        machineExemptions.expiresAt,
      ],
      where: sql`${machineExemptions.source} = 'schedule'`,
    })
    .returning();

  const row =
    inserted[0] ??
    (
      await openpathDb
        .select()
        .from(machineExemptions)
        .where(
          and(
            eq(machineExemptions.machineId, values.machineId),
            eq(machineExemptions.scheduleId, values.scheduleId),
            eq(machineExemptions.expiresAt, values.expiresAt)
          )
        )
        .limit(1)
    )[0];

  if (!row) {
    return undefined;
  }

  await notifyOpenPathClassroomChanged(values.classroomId);
  return row;
}

export async function createOperationalExemptionAndNotify(
  values: NewMachineExemption
): Promise<MachineExemptionRow | undefined> {
  const inserted = await openpathDb.insert(machineExemptions).values(values).returning();

  const row = inserted[0];
  if (!row) {
    return undefined;
  }

  await notifyOpenPathClassroomChanged(values.classroomId);
  return row;
}

export async function getExemptionById(
  id: string
): Promise<Pick<MachineExemptionRow, 'id' | 'classroomId' | 'source'> | undefined> {
  const existing = await openpathDb
    .select({
      id: machineExemptions.id,
      classroomId: machineExemptions.classroomId,
      source: machineExemptions.source,
    })
    .from(machineExemptions)
    .where(eq(machineExemptions.id, id))
    .limit(1);
  return existing[0];
}

export async function deleteExemptionAndNotify(
  exemptionId: string,
  classroomId: string
): Promise<void> {
  await openpathDb.delete(machineExemptions).where(eq(machineExemptions.id, exemptionId));
  await notifyOpenPathClassroomChanged(classroomId);
}
