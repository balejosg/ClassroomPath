import { and, eq, gt } from 'drizzle-orm';

import { machineExemptions, machines, openpathDb } from '../../db/openpath.js';

export async function listActiveClassroomExemptions(params: { classroomId: string; now?: Date }) {
  const now = params.now ?? new Date();

  const rows = await openpathDb
    .select({
      id: machineExemptions.id,
      machineId: machineExemptions.machineId,
      machineHostname: machines.hostname,
      classroomId: machineExemptions.classroomId,
      scheduleId: machineExemptions.scheduleId,
      source: machineExemptions.source,
      reason: machineExemptions.reason,
      createdBy: machineExemptions.createdBy,
      createdAt: machineExemptions.createdAt,
      expiresAt: machineExemptions.expiresAt,
    })
    .from(machineExemptions)
    .innerJoin(machines, eq(machines.id, machineExemptions.machineId))
    .where(
      and(
        eq(machineExemptions.classroomId, params.classroomId),
        gt(machineExemptions.expiresAt, now)
      )
    );

  return {
    classroomId: params.classroomId,
    exemptions: rows.map((row) => ({
      id: row.id,
      machineId: row.machineId,
      machineHostname: row.machineHostname,
      classroomId: row.classroomId,
      scheduleId: row.scheduleId,
      source: row.source === 'operational' ? 'operational' : 'schedule',
      reason: row.reason ?? null,
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt ? row.createdAt.toISOString() : null,
      expiresAt: row.expiresAt.toISOString(),
    })),
  };
}
