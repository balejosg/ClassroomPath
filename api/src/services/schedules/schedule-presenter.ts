import {
  mapToOneOffScheduleBase,
  mapToWeeklyScheduleBase,
  type DbSchedule,
} from './schedule-write-shared.service.js';
import type { ScheduleMetadataMaps } from './schedule-metadata.service.js';

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
export {
  presentOneOffScheduleWithPermissions,
  presentWeeklyScheduleWithPermissions,
} from './schedule-permission-presenter.js';
export {
  loadScheduleMetadataMaps,
  type ScheduleMetadataMaps,
} from './schedule-metadata.service.js';
