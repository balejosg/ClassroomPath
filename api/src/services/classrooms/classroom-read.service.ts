import {
  getCaptivePortalDomainsByIds,
  getClassroomById,
  getClassroomsByIds,
  getMachinesByClassroomIds,
  type ClassroomRow,
} from '../../db/openpath-repos/classrooms.repo.js';
import { getGroupDisplayNamesByIds } from '../../db/openpath-repos/groups.repo.js';
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

type OpenPathClassroomRow = ClassroomRow;
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

  const rows = await getClassroomsByIds(classroomIds);
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
  const machineRows = await getMachinesByClassroomIds(classroomIds);
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
  const classroom = await getClassroomById(params.classroomId);
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

  const domainsByClassroomId = await getCaptivePortalDomainsByIds(rows.map((row) => row.id));

  return rows.map((row) => ({
    ...row,
    captivePortalDomains: domainsByClassroomId.get(row.id) ?? [],
  }));
}
