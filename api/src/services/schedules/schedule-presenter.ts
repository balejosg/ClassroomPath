import { getGroupDisplayNamesByIds } from '../../lib/openpath-groups.js';
import { getUserNamesByIds } from '../../lib/openpath-users.js';
import {
  mapToOneOffScheduleBase,
  mapToWeeklyScheduleBase,
  type DbSchedule,
} from './schedule-write.service.js';

export type ScheduleMetadataMaps = {
  groupDisplayNamesById: ReadonlyMap<string, string>;
  teacherNamesById: ReadonlyMap<string, string>;
};

function collectScheduleMetadataIds(rows: readonly DbSchedule[]) {
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

export function presentWeeklySchedule(
  row: DbSchedule,
  metadata: ScheduleMetadataMaps
): ReturnType<typeof mapToWeeklyScheduleBase> & {
  groupDisplayName: string | null;
  teacherName: string | null;
} {
  const base = mapToWeeklyScheduleBase(row);

  return {
    ...base,
    groupDisplayName: metadata.groupDisplayNamesById.get(base.groupId) ?? null,
    teacherName: metadata.teacherNamesById.get(base.teacherId) ?? null,
  };
}

export function presentWeeklyScheduleWithPermissions(
  row: DbSchedule,
  metadata: ScheduleMetadataMaps,
  viewer: { userId: string; admin: boolean }
): ReturnType<typeof presentWeeklySchedule> & {
  isMine: boolean;
  canEdit: boolean;
} {
  const base = presentWeeklySchedule(row, metadata);
  const isMine = base.teacherId === viewer.userId;

  return {
    ...base,
    isMine,
    canEdit: isMine || viewer.admin,
  };
}

export function presentOneOffSchedule(
  row: DbSchedule,
  metadata: ScheduleMetadataMaps
): ReturnType<typeof mapToOneOffScheduleBase> & {
  groupDisplayName: string | null;
  teacherName: string | null;
} {
  const base = mapToOneOffScheduleBase(row);

  return {
    ...base,
    groupDisplayName: metadata.groupDisplayNamesById.get(base.groupId) ?? null,
    teacherName: metadata.teacherNamesById.get(base.teacherId) ?? null,
  };
}

export function presentOneOffScheduleWithPermissions(
  row: DbSchedule,
  metadata: ScheduleMetadataMaps,
  viewer: { userId: string; admin: boolean }
): ReturnType<typeof presentOneOffSchedule> & {
  isMine: boolean;
  canEdit: boolean;
} {
  const base = presentOneOffSchedule(row, metadata);
  const isMine = base.teacherId === viewer.userId;

  return {
    ...base,
    isMine,
    canEdit: isMine || viewer.admin,
  };
}
