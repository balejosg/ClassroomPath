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
