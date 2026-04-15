import { getGroupDisplayNamesByIds } from '../../lib/openpath-groups.js';
import { getUserNamesByIds } from '../../lib/openpath-users.js';
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
