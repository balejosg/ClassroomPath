import { and, eq, inArray } from 'drizzle-orm';

import { openpathDb, schedules } from '../../db/openpath.js';
import { getOrgClassroomIds } from '../org-classroom-membership.service.js';
import { loadScheduleMetadataMaps } from './schedule-metadata.service.js';
import { presentWeeklySchedule } from './schedule-presenter.js';
import type { ScheduleReadContext } from './schedule-read.service.js';
import { type DbSchedule, weeklyRecurrenceWhereClause } from './schedule-write-shared.service.js';

export async function getTeacherSchedulesForTenant(params: { ctx: ScheduleReadContext }) {
  const classroomIds = await getOrgClassroomIds({ organizationId: params.ctx.organizationId! });
  if (classroomIds.length === 0) return [];

  const rows: DbSchedule[] = await openpathDb
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.teacherId, params.ctx.user.sub),
        inArray(schedules.classroomId, classroomIds),
        weeklyRecurrenceWhereClause()
      )
    )
    .orderBy(schedules.dayOfWeek, schedules.startTime);

  const metadata = await loadScheduleMetadataMaps(rows);
  return rows.map((row) => presentWeeklySchedule(row, metadata));
}
