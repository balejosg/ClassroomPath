export const ALLOWED_OPENPATH_PROCEDURES: readonly string[] = [];

function isAllowedProcedure(proc: string): boolean {
  return ALLOWED_OPENPATH_PROCEDURES.some(
    (allowed) => proc === allowed || proc.startsWith(allowed + '.')
  );
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
  const blocked = procedures.find((proc) => !isAllowedProcedure(proc));
  return blocked ?? null;
}
