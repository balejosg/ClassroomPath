import { eq, inArray } from 'drizzle-orm';

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

  const now = new Date();
  const scheduleGroupByClassroomId = await getCurrentScheduleGroupByClassroomId({
    classroomIds,
    date: now,
  });
  const groupDisplayNamesById = await loadClassroomGroupDisplayNames({
    classrooms: rows,
    scheduleGroupIdByClassroomId: scheduleGroupByClassroomId,
  });
  const machineRows = await openpathDb
    .select()
    .from(machines)
    .where(inArray(machines.classroomId, classroomIds));
  const machinesByClassroomId = groupMachinesByClassroomIdForList(machineRows, now);

  return rows.map((classroom) =>
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
  const scheduleGroupId = await getCurrentScheduleGroupId({ classroomId: params.classroom.id });
  const groupDisplayNamesById = await loadClassroomGroupDisplayNames({
    classrooms: [params.classroom],
    scheduleGroupId,
  });
  return presentClassroomBase({
    classroom: params.classroom,
    scheduleGroupId,
    groupDisplayNamesById,
  });
}
