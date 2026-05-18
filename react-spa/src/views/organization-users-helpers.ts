import { normalizeUserRoleString } from '../openpath/roles';
import { translateClassroomPathText, type ClassroomPathT } from '../i18n/classroompath-i18n';

export type InviteRole = 'admin' | 'teacher';

export type MemberRow = {
  kind: 'member';
  id: string;
  name: string;
  email: string;
  role: InviteRole | 'user';
  status: 'active' | 'inactive';
};

export type InvitationRow = {
  kind: 'invitation';
  id: string;
  name: string;
  email: string;
  role: InviteRole;
  status: 'pending';
  expiresAt: string;
};

export type TableRow = MemberRow | InvitationRow;

export type DeliveryNotice = {
  tone: 'success' | 'warning';
  title: string;
  description: string;
};

type RoleEntry = { role: string };

export type MemberRecord = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  roles: RoleEntry[];
};

export type InvitationRecord = {
  id: string;
  name: string;
  email: string;
  role: InviteRole;
  expiresAt: string;
};

export function getPrimaryRoleLabel(roles: RoleEntry[]): InviteRole | 'user' {
  const normalizedRoles = roles
    .map((entry) => normalizeUserRoleString(entry.role))
    .filter((value): value is InviteRole | 'student' => value !== null);

  if (normalizedRoles.includes('admin')) return 'admin';
  if (normalizedRoles.includes('teacher')) return 'teacher';
  return 'user';
}

const englishT: ClassroomPathT = (key, params) => translateClassroomPathText('en', key, params);

export function getRoleLabel(role: InviteRole | 'user', t: ClassroomPathT = englishT): string {
  if (role === 'admin') return t('app.common.admin');
  if (role === 'teacher') return t('app.common.teacher');
  return t('app.common.user');
}

export function buildMemberRows(users: MemberRecord[]): MemberRow[] {
  return users.map((user) => ({
    kind: 'member',
    id: user.id,
    name: user.name,
    email: user.email,
    role: getPrimaryRoleLabel(user.roles),
    status: user.isActive ? 'active' : 'inactive',
  }));
}

export function buildInvitationRows(invitations: InvitationRecord[]): InvitationRow[] {
  return invitations.map((invitation) => ({
    kind: 'invitation',
    id: invitation.id,
    name: invitation.name,
    email: invitation.email,
    role: invitation.role,
    status: 'pending',
    expiresAt: invitation.expiresAt,
  }));
}

export function filterOrganizationUserRows({
  memberRows,
  invitationRows,
  searchQuery,
}: {
  memberRows: MemberRow[];
  invitationRows: InvitationRow[];
  searchQuery: string;
}): TableRow[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const rows = [...memberRows, ...invitationRows].sort((left, right) =>
    left.name.localeCompare(right.name, 'en')
  );

  if (!normalizedQuery) return rows;

  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(normalizedQuery) ||
      row.email.toLowerCase().includes(normalizedQuery)
  );
}

export function getSummaryLabel(totalRows: number, t: ClassroomPathT = englishT): string {
  return totalRows === 0 ? t('orgUsers.showingNone') : t('orgUsers.showing', { count: totalRows });
}

export function getDeliveryNoticeFromInvitationResult({
  email,
  emailSent,
  t = englishT,
}: {
  email: string;
  emailSent: boolean;
  t?: ClassroomPathT;
}): DeliveryNotice {
  if (emailSent) {
    return {
      tone: 'success',
      title: t('orgUsers.invitationSent'),
      description: t('orgUsers.invitationSentBody', { email }),
    };
  }

  return {
    tone: 'warning',
    title: t('orgUsers.invitationPending'),
    description: t('orgUsers.invitationPendingBody', { email }),
  };
}

export function getDeliveryNoticeFromResetResult({
  email,
  emailSent,
  t = englishT,
}: {
  email: string;
  emailSent: boolean;
  t?: ClassroomPathT;
}): DeliveryNotice {
  if (emailSent) {
    return {
      tone: 'success',
      title: t('orgUsers.resetSent'),
      description: t('orgUsers.resetSentBody', { email }),
    };
  }

  return {
    tone: 'warning',
    title: t('orgUsers.resetPending'),
    description: t('orgUsers.resetPendingBody', { email }),
  };
}

export function getRowInitials(name: string): string {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment[0])
    .join('')
    .toUpperCase();

  return initials || '??';
}

export function getStatusClasses(status: TableRow['status']): string {
  if (status === 'pending') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
}
