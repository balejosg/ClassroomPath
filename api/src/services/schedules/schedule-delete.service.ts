import { deleteScheduleAndNotify } from '../../db/openpath-repos/schedules.repo.js';
import { assertOrgClassroomAccess } from '../../lib/tenant-access.js';
import {
  assertCanManageSchedule,
  loadScheduleOrThrow,
  type ScheduleWriteContext,
} from './schedule-write-shared.service.js';

export async function deleteScheduleForTenant(params: {
  ctx: ScheduleWriteContext;
  id: string;
}): Promise<void> {
  const schedule = await loadScheduleOrThrow(params.id);

  await assertOrgClassroomAccess(params.ctx.organizationId!, schedule.classroomId);
  assertCanManageSchedule(params.ctx, schedule);

  await deleteScheduleAndNotify(params.id, schedule.classroomId);
}
