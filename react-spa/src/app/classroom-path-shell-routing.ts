export type AppTab =
  | 'dashboard'
  | 'classrooms'
  | 'groups'
  | 'rules'
  | 'users'
  | 'domains'
  | 'settings';

export function normalizeShellPathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

export function getTabFromPathname(pathname: string): AppTab {
  const normalized = normalizeShellPathname(pathname);

  if (normalized === '/' || normalized.startsWith('/dashboard')) return 'dashboard';
  if (normalized.startsWith('/classrooms')) return 'classrooms';
  if (normalized.startsWith('/policies')) return 'groups';
  if (normalized.startsWith('/rules')) return 'rules';
  if (normalized.startsWith('/users')) return 'users';
  if (normalized.startsWith('/domain-requests')) return 'domains';
  if (normalized.startsWith('/settings')) return 'settings';

  return 'dashboard';
}

export function getPathForTab(tab: AppTab): string {
  switch (tab) {
    case 'dashboard':
      return '/';
    case 'classrooms':
      return '/classrooms';
    case 'groups':
      return '/policies';
    case 'rules':
      return '/rules';
    case 'users':
      return '/users';
    case 'domains':
      return '/domain-requests';
    case 'settings':
      return '/settings';
    default:
      return '/';
  }
}
