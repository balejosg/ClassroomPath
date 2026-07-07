import { getWeeklySchedulesForTeacher } from '../../db/openpath-repos/schedules.repo.js';
import { getOrgClassroomIds } from '../org-classroom-membership.service.js';
import { loadScheduleMetadataMaps } from './schedule-metadata.service.js';
import { presentWeeklySchedule } from './schedule-presenter.js';
import type { ScheduleReadContext } from './schedule-read.service.js';
import type { DbSchedule } from './schedule-write-shared.service.js';

export async function getTeacherSchedulesForTenant(params: { ctx: ScheduleReadContext }) {
  const classroomIds = await getOrgClassroomIds({ organizationId: params.ctx.organizationId! });
  if (classroomIds.length === 0) return [];

  const rows: DbSchedule[] = await getWeeklySchedulesForTeacher({
    teacherId: params.ctx.user.sub,
    classroomIds,
  });

  const metadata = await loadScheduleMetadataMaps(rows);
  return rows.map((row) => presentWeeklySchedule(row, metadata));
}
