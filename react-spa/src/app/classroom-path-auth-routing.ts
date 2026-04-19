export type AuthView =
  | 'landing'
  | 'pricing'
  | 'login'
  | 'register'
  | 'reset-password'
  | 'accept-invitation';

export function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

export function getAuthViewFromPathname(pathname: string): AuthView {
  const normalized = normalizePathname(pathname);

  if (normalized.startsWith('/register')) return 'register';
  if (normalized.startsWith('/reset-password')) return 'reset-password';
  if (normalized.startsWith('/accept-invitation')) return 'accept-invitation';
  if (normalized.startsWith('/login')) return 'login';
  if (normalized.startsWith('/pricing')) return 'pricing';
  return 'landing';
}

export function isAuthPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return (
    normalized === '/' ||
    normalized.startsWith('/pricing') ||
    normalized.startsWith('/login') ||
    normalized.startsWith('/register') ||
    normalized.startsWith('/reset-password') ||
    normalized.startsWith('/accept-invitation')
  );
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    navigatorWithStandalone.standalone === true
  );
}

export function shouldRouteUnauthenticatedToLogin(params: {
  pathname: string;
  isStandalone: boolean;
}): boolean {
  const normalized = normalizePathname(params.pathname);

  if (normalized.startsWith('/login')) return false;
  if (normalized.startsWith('/register')) return false;
  if (normalized.startsWith('/reset-password')) return false;
  if (normalized.startsWith('/accept-invitation')) return false;
  if (normalized === '/') return params.isStandalone;
  if (normalized.startsWith('/pricing')) return false;

  return true;
}

export function getSafeInternalNextPath(search: string): string | null {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;

  try {
    const parsed = new URL(next, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function getLoginPathForRedirect(pathname: string, search = ''): string {
  const normalized = normalizePathname(pathname);
  if (normalized === '/') return '/login';

  const next = `${normalized}${search}`;
  return `/login?next=${encodeURIComponent(next)}`;
}

export function isBillingSuccessPath(pathname: string): boolean {
  return normalizePathname(pathname).startsWith('/billing/success');
}

export function isBillingCancelPath(pathname: string): boolean {
  return normalizePathname(pathname).startsWith('/billing/cancel');
}

export function getPathForAuthView(view: AuthView): string {
  switch (view) {
    case 'register':
      return '/register';
    case 'reset-password':
      return '/reset-password';
    case 'accept-invitation':
      return '/accept-invitation';
    case 'login':
      return '/login';
    case 'pricing':
      return '/pricing';
    case 'landing':
    default:
      return '/';
  }
}
