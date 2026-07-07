import { TRPCError } from '@trpc/server';

import { getClassroomById } from '../../db/openpath-repos/classrooms.repo.js';
import {
  getOneOffSchedulesForClassroom,
  getWeeklySchedulesForClassroom,
} from '../../db/openpath-repos/schedules.repo.js';
import { assertOrgClassroomAccess, isOrgAdmin } from '../../lib/tenant-access.js';
import { loadScheduleMetadataMaps } from './schedule-metadata.service.js';
import {
  presentOneOffScheduleWithPermissions,
  presentWeeklyScheduleWithPermissions,
} from './schedule-permission-presenter.js';
import type { ScheduleReadContext } from './schedule-read.service.js';
import type { DbSchedule } from './schedule-write-shared.service.js';

async function loadClassroomOrThrow(classroomId: string) {
  const row = await getClassroomById(classroomId);
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
    getWeeklySchedulesForClassroom(params.classroomId),
    getOneOffSchedulesForClassroom(params.classroomId),
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
