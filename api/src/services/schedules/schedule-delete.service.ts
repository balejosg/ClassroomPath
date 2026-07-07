import { eq } from 'drizzle-orm';

import { openpathDb, schedules } from '../../db/openpath.js';
import { notifyOpenPathClassroomChanged } from '../../db/openpath-repos/publish.js';
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

  await openpathDb.delete(schedules).where(eq(schedules.id, params.id));
  await notifyOpenPathClassroomChanged(schedule.classroomId);
}
