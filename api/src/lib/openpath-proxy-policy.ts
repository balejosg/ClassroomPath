export interface OpenPathProxyRoutePolicy {
  method: 'get' | 'use';
  path: string;
  proxyTimeout?: number;
  timeout?: number;
}

export interface OpenPathProxyManifest {
  allowedTrpcProcedures: readonly string[];
  blockedPassthroughPrefixes: readonly string[];
  notFoundRoutes: readonly string[];
  proxyRoutes: readonly OpenPathProxyRoutePolicy[];
}

export const OPENPATH_PROXY_MANIFEST = {
  proxyRoutes: [
    {
      method: 'get',
      path: '/health',
    },
    {
      method: 'get',
      path: '/api/config',
    },
    {
      method: 'use',
      path: '/api/machines/events',
      proxyTimeout: 0,
      timeout: 0,
    },
  ],
  notFoundRoutes: ['/v2', '/export'],
  blockedPassthroughPrefixes: ['/api', '/w', '/api-docs'],
  allowedTrpcProcedures: [],
} as const satisfies OpenPathProxyManifest;

function matchesPathPrefix(requestPath: string, candidate: string): boolean {
  return requestPath === candidate || requestPath.startsWith(candidate + '/');
}

function normalizeRequestPath(reqUrl: string): string {
  return reqUrl.split('?')[0] || '/';
}

function isAllowedProcedure(proc: string): boolean {
  return OPENPATH_PROXY_MANIFEST.allowedTrpcProcedures.some(
    (allowed) => proc === allowed || proc.startsWith(allowed + '.')
  );
}

export function findBlockedOpenPathPassthroughPath(reqUrl: string): string | null {
  const requestPath = normalizeRequestPath(reqUrl);

  const isKnownProxyRoute = OPENPATH_PROXY_MANIFEST.proxyRoutes.some((route) =>
    matchesPathPrefix(requestPath, route.path)
  );
  if (isKnownProxyRoute) {
    return null;
  }

  const blocked = OPENPATH_PROXY_MANIFEST.blockedPassthroughPrefixes.find((prefix) =>
    matchesPathPrefix(requestPath, prefix)
  );
  return blocked ? requestPath : null;
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

  const rawPath = normalizeRequestPath(reqUrl).slice('/trpc'.length);
  const procedurePath = rawPath.replace(/^\//, '');
  if (!procedurePath) return null;

  const procedures = procedurePath
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const blocked = procedures.find((proc) => !isAllowedProcedure(proc));
  return blocked ?? null;
}
