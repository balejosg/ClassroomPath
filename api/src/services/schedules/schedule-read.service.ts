export type ScheduleReadContext = Parameters<typeof isOrgAdmin>[0] & {
  organizationId?: string;
  user: { sub: string };
};
import { isOrgAdmin } from '../../lib/tenant-access.js';

export { getClassroomSchedulesForTenant } from './schedule-classroom-read.service.js';
export { getTeacherSchedulesForTenant } from './schedule-teacher-read.service.js';
