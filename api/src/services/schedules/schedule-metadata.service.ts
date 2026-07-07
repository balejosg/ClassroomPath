import { getGroupDisplayNamesByIds } from '../../db/openpath-repos/groups.repo.js';
import { getUserNamesByIds } from '../../db/openpath-repos/users.repo.js';
import type { DbSchedule } from './schedule-write-shared.service.js';

export type ScheduleMetadataMaps = {
  groupDisplayNamesById: ReadonlyMap<string, string>;
  teacherNamesById: ReadonlyMap<string, string>;
};

export function collectScheduleMetadataIds(rows: readonly DbSchedule[]) {
  return {
    groupIds: rows.map((row) => row.groupId),
    teacherIds: rows.map((row) => row.teacherId),
  };
}

export async function loadScheduleMetadataMaps(
  rows: readonly DbSchedule[]
): Promise<ScheduleMetadataMaps> {
  const metadataInputs = collectScheduleMetadataIds(rows);
  const [groupDisplayNamesById, teacherNamesById] = await Promise.all([
    getGroupDisplayNamesByIds(metadataInputs.groupIds),
    getUserNamesByIds(metadataInputs.teacherIds),
  ]);

  return { groupDisplayNamesById, teacherNamesById };
}
