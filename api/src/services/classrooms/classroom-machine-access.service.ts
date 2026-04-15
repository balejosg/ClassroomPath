import { TRPCError } from '@trpc/server';
import { eq, inArray } from 'drizzle-orm';

import { machines, openpathDb } from '../../db/openpath.js';
import { getOrgClassroomIds } from '../org-classroom-membership.service.js';

type OpenPathMachineRow = typeof machines.$inferSelect;

export type ClassroomMachineSummary = {
  id: string;
  hostname: string;
  classroomId: string | null;
  version: string | null;
  lastSeen: string | null;
  hasDownloadToken: boolean;
  downloadTokenLastRotatedAt: string | null;
};

export function presentClassroomMachineSummary(
  machine: OpenPathMachineRow
): ClassroomMachineSummary {
  return {
    id: machine.id,
    hostname: machine.hostname,
    classroomId: machine.classroomId,
    version: machine.version,
    lastSeen: machine.lastSeen?.toISOString() ?? null,
    hasDownloadToken: machine.downloadTokenHash !== null,
    downloadTokenLastRotatedAt: machine.downloadTokenLastRotatedAt?.toISOString() ?? null,
  };
}

export async function listTenantClassroomMachines(params: {
  organizationId: string;
  classroomId?: string;
}): Promise<ClassroomMachineSummary[]> {
  const classroomIds = await getOrgClassroomIds({ organizationId: params.organizationId });
  if (classroomIds.length === 0) {
    return [];
  }

  if (params.classroomId) {
    if (!classroomIds.includes(params.classroomId)) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Classroom not found or access denied',
      });
    }

    const rows = await openpathDb
      .select()
      .from(machines)
      .where(eq(machines.classroomId, params.classroomId));
    return rows.map(presentClassroomMachineSummary);
  }

  const rows = await openpathDb
    .select()
    .from(machines)
    .where(inArray(machines.classroomId, classroomIds));
  return rows.map(presentClassroomMachineSummary);
}
