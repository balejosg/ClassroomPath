import type { DbSchedule } from './schedule-write-shared.service.js';
import {
  presentOneOffSchedule,
  presentWeeklySchedule,
  type ScheduleMetadataMaps,
} from './schedule-presenter.js';

export function buildScheduleViewerPermissions(params: {
  teacherId: string;
  viewer: { userId: string; admin: boolean };
}) {
  const isMine = params.teacherId === params.viewer.userId;

  return {
    isMine,
    canEdit: isMine || params.viewer.admin,
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

  return {
    ...base,
    ...buildScheduleViewerPermissions({ teacherId: base.teacherId, viewer }),
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

  return {
    ...base,
    ...buildScheduleViewerPermissions({ teacherId: base.teacherId, viewer }),
  };
}
