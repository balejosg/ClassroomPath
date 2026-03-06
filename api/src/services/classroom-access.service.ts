import { TRPCError } from '@trpc/server';
import { and, eq, gt, inArray } from 'drizzle-orm';
import {
  openpathDb,
  classrooms,
  machineExemptions,
  machines,
} from '../db/openpath.js';
import { getCurrentScheduleGroupByClassroomId, getCurrentScheduleGroupId } from './current-group.service.js';
import {
  groupMachinesByClassroomIdForList,
  presentClassroomBase,
  presentClassroomListItem,
} from './classroom-presenter.js';
import { getOrgClassroomIds } from './org-classroom-membership.service.js';

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

function presentClassroomMachineSummary(machine: OpenPathMachineRow): ClassroomMachineSummary {
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

export async function listTenantClassrooms(params: { organizationId: string }) {
  const classroomIds = await getOrgClassroomIds({ organizationId: params.organizationId });
  if (classroomIds.length === 0) {
    return [];
  }

  const rows = await openpathDb.select().from(classrooms).where(inArray(classrooms.id, classroomIds));

  const now = new Date();
  const scheduleGroupByClassroomId = await getCurrentScheduleGroupByClassroomId({
    classroomIds,
    date: now,
  });
  const machineRows = await openpathDb.select().from(machines).where(inArray(machines.classroomId, classroomIds));
  const machinesByClassroomId = groupMachinesByClassroomIdForList(machineRows, now);

  return rows.map((classroom) =>
    presentClassroomListItem({
      classroom,
      scheduleGroupId: scheduleGroupByClassroomId.get(classroom.id) ?? null,
      machines: machinesByClassroomId.get(classroom.id) ?? [],
    })
  );
}

export async function getTenantClassroomById(params: { classroomId: string }) {
  const rows = await openpathDb
    .select()
    .from(classrooms)
    .where(eq(classrooms.id, params.classroomId))
    .limit(1);

  const classroom = rows[0];
  if (!classroom) {
    return null;
  }

  const scheduleGroupId = await getCurrentScheduleGroupId({ classroomId: classroom.id });
  return presentClassroomBase({ classroom, scheduleGroupId });
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

  const rows = await openpathDb.select().from(machines).where(inArray(machines.classroomId, classroomIds));
  return rows.map(presentClassroomMachineSummary);
}

export async function listActiveClassroomExemptions(params: {
  classroomId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();

  const rows = await openpathDb
    .select({
      id: machineExemptions.id,
      machineId: machineExemptions.machineId,
      machineHostname: machines.hostname,
      classroomId: machineExemptions.classroomId,
      scheduleId: machineExemptions.scheduleId,
      createdBy: machineExemptions.createdBy,
      createdAt: machineExemptions.createdAt,
      expiresAt: machineExemptions.expiresAt,
    })
    .from(machineExemptions)
    .innerJoin(machines, eq(machines.id, machineExemptions.machineId))
    .where(and(eq(machineExemptions.classroomId, params.classroomId), gt(machineExemptions.expiresAt, now)));

  return {
    classroomId: params.classroomId,
    exemptions: rows.map((row) => ({
      id: row.id,
      machineId: row.machineId,
      machineHostname: row.machineHostname,
      classroomId: row.classroomId,
      scheduleId: row.scheduleId,
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt ? row.createdAt.toISOString() : null,
      expiresAt: row.expiresAt.toISOString(),
    })),
  };
}
