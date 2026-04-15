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
  if (normalized.startsWith('/aulas')) return 'classrooms';
  if (normalized.startsWith('/politicas') || normalized.startsWith('/grupos')) return 'groups';
  if (normalized.startsWith('/reglas')) return 'rules';
  if (normalized.startsWith('/usuarios')) return 'users';
  if (normalized.startsWith('/dominios')) return 'domains';
  if (normalized.startsWith('/configuracion') || normalized.startsWith('/settings'))
    return 'settings';

  return 'dashboard';
}

export function getPathForTab(tab: AppTab): string {
  switch (tab) {
    case 'dashboard':
      return '/';
    case 'classrooms':
      return '/aulas';
    case 'groups':
      return '/politicas';
    case 'rules':
      return '/reglas';
    case 'users':
      return '/usuarios';
    case 'domains':
      return '/dominios';
    case 'settings':
      return '/configuracion';
    default:
      return '/';
  }
}
