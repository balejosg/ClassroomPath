export interface OpenPathProxyRoutePolicy {
  method: 'get' | 'use';
  path: string;
  proxyTimeout?: number;
  timeout?: number;
}

export interface OpenPathProxyRewriteRule {
  publicPath: string;
  targetPath?: string;
  rewrite?: (reqUrl: string) => string | null;
}

export interface OpenPathProxyManifest {
  allowedTrpcProcedures: readonly string[];
  blockedPassthroughPrefixes: readonly string[];
  notFoundRoutes: readonly string[];
  proxyRoutes: readonly OpenPathProxyRoutePolicy[];
}

function encodeWildcardPath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
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
      method: 'get',
      path: '/api/extensions/firefox/openpath.xpi',
    },
    {
      method: 'use',
      path: '/api/extensions/chromium',
    },
    {
      method: 'use',
      path: '/api/enroll',
    },
    {
      method: 'use',
      path: '/api/requests/submit',
    },
    {
      method: 'use',
      path: '/api/requests/status',
    },
    {
      method: 'use',
      path: '/cp/api/requests/status',
    },
    {
      method: 'use',
      path: '/api/agent/windows',
    },
    {
      method: 'use',
      path: '/api/agent/linux',
    },
    {
      method: 'use',
      path: '/api/machines/events',
      proxyTimeout: 0,
      timeout: 0,
    },
    {
      method: 'use',
      path: '/api/machines',
    },
    {
      method: 'use',
      path: '/w',
    },
    {
      method: 'use',
      path: '/trpc/healthReports.submit',
    },
  ],
  notFoundRoutes: ['/v2', '/export'],
  blockedPassthroughPrefixes: ['/api', '/w', '/api-docs'],
  allowedTrpcProcedures: ['healthReports.submit'],
} as const satisfies OpenPathProxyManifest;

export const OPENPATH_PROXY_REWRITE_RULES = [
  {
    publicPath: '/cp/api/requests/status',
    rewrite(reqUrl: string) {
      return reqUrl.replace(/^\/cp\/api\/requests\/status(?=\/|\?|$)/, '/api/requests/status');
    },
  },
  {
    publicPath: '/api/agent/windows/bootstrap/latest.json',
    targetPath: '/api/agent/windows/bootstrap/manifest',
  },
  {
    publicPath: '/api/agent/windows/latest.json',
    targetPath: '/api/agent/windows/manifest',
  },
  {
    publicPath: '/api/agent/linux/latest.json',
    targetPath: '/api/agent/linux/manifest',
  },
  {
    publicPath: '/api/agent/windows/bootstrap/file',
    rewrite(reqUrl: string) {
      const [, rawQuery = ''] = reqUrl.split('?', 2);
      const filePath = new URLSearchParams(rawQuery).get('path')?.trim();
      return filePath ? `/api/agent/windows/bootstrap/files/${encodeWildcardPath(filePath)}` : null;
    },
  },
  {
    publicPath: '/api/agent/windows/file',
    rewrite(reqUrl: string) {
      const [, rawQuery = ''] = reqUrl.split('?', 2);
      const filePath = new URLSearchParams(rawQuery).get('path')?.trim();
      return filePath ? `/api/agent/windows/files/${encodeWildcardPath(filePath)}` : null;
    },
  },
] as const satisfies readonly OpenPathProxyRewriteRule[];

function matchesPathPrefix(requestPath: string, candidate: string): boolean {
  return requestPath === candidate || requestPath.startsWith(candidate + '/');
}

function normalizeRequestPath(reqUrl: string): string {
  return reqUrl.split('?')[0] || '/';
}

export function rewriteOpenPathProxyUrl(reqUrl: string): string {
  const requestPath = normalizeRequestPath(reqUrl);

  for (const rule of OPENPATH_PROXY_REWRITE_RULES) {
    if (
      requestPath !== rule.publicPath &&
      !('rewrite' in rule && matchesPathPrefix(requestPath, rule.publicPath))
    ) {
      continue;
    }

    if ('targetPath' in rule && rule.targetPath) {
      return rule.targetPath;
    }

    const rewritten = 'rewrite' in rule ? rule.rewrite?.(reqUrl) : null;
    return rewritten ?? reqUrl;
  }

  return reqUrl;
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
