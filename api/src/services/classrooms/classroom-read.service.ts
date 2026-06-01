import { eq, inArray, sql } from 'drizzle-orm';

import { classrooms, machines, openpathDb } from '../../db/openpath.js';
import { getGroupDisplayNamesByIds } from '../../lib/openpath-groups.js';
import { getOrgClassroomIds } from '../org-classroom-membership.service.js';
import {
  getCurrentScheduleGroupByClassroomId,
  getCurrentScheduleGroupId,
} from '../schedules/current-group.service.js';
import {
  groupMachinesByClassroomIdForList,
  presentClassroomBase,
  presentClassroomListItem,
} from './classroom-presenter.js';

type OpenPathClassroomRow = typeof classrooms.$inferSelect;
type OpenPathClassroomRowWithCaptivePortalDomains = OpenPathClassroomRow & {
  captivePortalDomains?: string[] | null;
};

export async function loadClassroomGroupDisplayNames(params: {
  classrooms: OpenPathClassroomRow[];
  scheduleGroupIdByClassroomId?: ReadonlyMap<string, string>;
  scheduleGroupId?: string | null;
}): Promise<Map<string, string>> {
  const groupIds = params.classrooms.flatMap((classroom) =>
    [classroom.defaultGroupId, classroom.activeGroupId].filter((value): value is string => !!value)
  );

  if (params.scheduleGroupIdByClassroomId) {
    groupIds.push(...params.scheduleGroupIdByClassroomId.values());
  }

  if (params.scheduleGroupId) {
    groupIds.push(params.scheduleGroupId);
  }

  return getGroupDisplayNamesByIds(groupIds);
}

export async function listTenantClassrooms(params: { organizationId: string }) {
  const classroomIds = await getOrgClassroomIds({ organizationId: params.organizationId });
  if (classroomIds.length === 0) {
    return [];
  }

  const rows = await openpathDb
    .select()
    .from(classrooms)
    .where(inArray(classrooms.id, classroomIds));
  const rowsWithCaptivePortalDomains = await attachCaptivePortalDomains(rows);

  const now = new Date();
  const scheduleGroupByClassroomId = await getCurrentScheduleGroupByClassroomId({
    classroomIds,
    date: now,
  });
  const groupDisplayNamesById = await loadClassroomGroupDisplayNames({
    classrooms: rowsWithCaptivePortalDomains,
    scheduleGroupIdByClassroomId: scheduleGroupByClassroomId,
  });
  const machineRows = await openpathDb
    .select()
    .from(machines)
    .where(inArray(machines.classroomId, classroomIds));
  const machinesByClassroomId = groupMachinesByClassroomIdForList(machineRows, now);

  return rowsWithCaptivePortalDomains.map((classroom) =>
    presentClassroomListItem({
      classroom,
      scheduleGroupId: scheduleGroupByClassroomId.get(classroom.id) ?? null,
      groupDisplayNamesById,
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

  return presentTenantClassroom({ classroom });
}

export async function presentTenantClassroom(params: { classroom: OpenPathClassroomRow }) {
  const [classroom] = await attachCaptivePortalDomains([params.classroom]);
  const scheduleGroupId = await getCurrentScheduleGroupId({ classroomId: params.classroom.id });
  const groupDisplayNamesById = await loadClassroomGroupDisplayNames({
    classrooms: [classroom],
    scheduleGroupId,
  });
  return presentClassroomBase({
    classroom,
    scheduleGroupId,
    groupDisplayNamesById,
  });
}

async function attachCaptivePortalDomains(
  rows: OpenPathClassroomRow[]
): Promise<OpenPathClassroomRowWithCaptivePortalDomains[]> {
  if (rows.length === 0) {
    return [];
  }

  try {
    const ids = sql.join(
      rows.map((row) => sql`${row.id}`),
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
    const domainsByClassroomId = new Map(
      result.rows.map((row) => [row.id, row.captive_portal_domains ?? []])
    );

    return rows.map((row) => ({
      ...row,
      captivePortalDomains: domainsByClassroomId.get(row.id) ?? [],
    }));
  } catch (err) {
    if (isMissingCaptivePortalDomainsColumnError(err)) {
      return rows.map((row) => ({ ...row, captivePortalDomains: [] }));
    }
    throw err;
  }
}

function isMissingCaptivePortalDomainsColumnError(err: unknown): boolean {
  const error = err as { code?: string; cause?: { code?: string }; message?: string };
  return (
    error.code === '42703' ||
    error.cause?.code === '42703' ||
    error.message?.includes('captive_portal_domains') === true
  );
}
