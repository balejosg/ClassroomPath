import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { openpathDb, classrooms, schedules } from '../../db/openpath.js';
import { assertOrgClassroomAccess, isOrgAdmin } from '../../lib/tenant-access.js';
import { loadScheduleMetadataMaps } from './schedule-metadata.service.js';
import {
  presentOneOffScheduleWithPermissions,
  presentWeeklyScheduleWithPermissions,
} from './schedule-permission-presenter.js';
import type { ScheduleReadContext } from './schedule-read.service.js';
import { type DbSchedule, weeklyRecurrenceWhereClause } from './schedule-write-shared.service.js';

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
