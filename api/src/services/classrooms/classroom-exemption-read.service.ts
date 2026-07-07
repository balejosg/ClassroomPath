import { getActiveExemptionsForClassroom } from '../../db/openpath-repos/machine-exemptions.repo.js';

export async function listActiveClassroomExemptions(params: { classroomId: string; now?: Date }) {
  const now = params.now ?? new Date();

  const rows = await getActiveExemptionsForClassroom({ classroomId: params.classroomId, now });

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
