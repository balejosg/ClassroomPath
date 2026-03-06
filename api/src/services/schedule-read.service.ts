import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import { openpathDb, schedules, classrooms } from '../db/openpath.js';
import { assertOrgClassroomAccess, isOrgAdmin } from '../lib/tenant-access.js';
import { getOrgClassroomIds } from './org-classroom-membership.service.js';
import {
  loadScheduleMetadataMaps,
  presentOneOffScheduleWithPermissions,
  presentWeeklySchedule,
  presentWeeklyScheduleWithPermissions,
} from './schedule-presenter.js';
import { type DbSchedule, weeklyRecurrenceWhereClause } from './schedule-write.service.js';

export type ScheduleReadContext = Parameters<typeof isOrgAdmin>[0] & {
  organizationId?: string;
  user: { sub: string };
};

async function loadClassroomOrThrow(classroomId: string) {
  const classroom = await openpathDb
    .select()
    .from(classrooms)
    .where(eq(classrooms.id, classroomId))
    .limit(1);

  const row = classroom[0];
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found' });
  }

  return row;
}

export async function getClassroomSchedulesForTenant(params: {
  ctx: ScheduleReadContext;
  classroomId: string;
}) {
  await assertOrgClassroomAccess(params.ctx.organizationId!, params.classroomId);

  const classroom = await loadClassroomOrThrow(params.classroomId);
  const [weeklyRows, oneOffRows] = await Promise.all([
    openpathDb
      .select()
      .from(schedules)
      .where(and(eq(schedules.classroomId, params.classroomId), weeklyRecurrenceWhereClause()))
      .orderBy(schedules.dayOfWeek, schedules.startTime),
    openpathDb
      .select()
      .from(schedules)
      .where(
        and(eq(schedules.classroomId, params.classroomId), eq(schedules.recurrence, 'one_off'))
      )
      .orderBy(schedules.startAt),
  ]);

  const metadata = await loadScheduleMetadataMaps([...weeklyRows, ...oneOffRows]);
  const viewer = { userId: params.ctx.user.sub, admin: isOrgAdmin(params.ctx) };

  return {
    classroom: {
      id: classroom.id,
      name: classroom.name,
      displayName: classroom.displayName,
    },
    schedules: weeklyRows.map((row) =>
      presentWeeklyScheduleWithPermissions(row as DbSchedule, metadata, viewer)
    ),
    oneOffSchedules: oneOffRows.map((row) =>
      presentOneOffScheduleWithPermissions(row as DbSchedule, metadata, viewer)
    ),
  };
}

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
