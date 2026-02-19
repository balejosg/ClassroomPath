export const BLOCKED_OPENPATH_PROCEDURES = [
  // Block schedules to prevent tenant-scoping bypass (ClassroomPath exposes tenant-scoped schedules via /cp/trpc).
  'schedules',
  'groups.list',
  'groups.getById',
  'groups.getByName',
  'groups.listRules',
  'groups.listRulesGrouped',
  'classrooms.list',
  'classrooms.get',
  'classrooms.listMachines',
  'users.list',
  'users.get',
  'users.listTeachers',
  'requests.list',
  'requests.get',
  'requests.getStatus',
  // Block mutations to prevent tenant-scoping bypass
  'requests.create',
  'requests.approve',
  'requests.reject',
  'requests.delete',
  'requests.listGroups',
] as const;

function isBlockedProcedure(proc: string): boolean {
  return BLOCKED_OPENPATH_PROCEDURES.some((b) => proc === b || proc.startsWith(b + '.'));
}

/**
 * Given an Express req.url, return the first blocked OpenPath tRPC procedure (if any).
 *
 * Supports:
 * - Single calls:  /trpc/groups.list
 * - Batch calls:   /trpc/auth.me,groups.list?batch=1
 */
export function findBlockedOpenPathProcedureFromUrl(reqUrl: string): string | null {
  if (!reqUrl.startsWith('/trpc')) return null;

  const rawPath = reqUrl.slice('/trpc'.length);
  const procedurePath = rawPath.split('?')[0].replace(/^\//, '');
  if (!procedurePath) return null;

  const procedures = procedurePath
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const blocked = procedures.find((proc) => isBlockedProcedure(proc));
  return blocked ?? null;
}
