import { normalizeUserRoleString } from '@openpath/shared/roles';

export type InviteRole = 'admin' | 'teacher';

export type MemberRow = {
  kind: 'member';
  id: string;
  name: string;
  email: string;
  role: InviteRole | 'user';
  status: 'Activo' | 'Inactivo';
};

export type InvitationRow = {
  kind: 'invitation';
  id: string;
  name: string;
  email: string;
  role: InviteRole;
  status: 'Pendiente';
  expiresAt: string;
};

export type TableRow = MemberRow | InvitationRow;

export type DeliveryNotice =
  | {
      tone: 'success';
      title: string;
      description: string;
    }
  | {
      tone: 'warning';
      title: string;
      description: string;
      url: string;
    };

type RoleEntry = { role: string };

type MemberRecord = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  roles: RoleEntry[];
};

type InvitationRecord = {
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

export function getRoleLabel(role: InviteRole | 'user'): string {
  if (role === 'admin') return 'Administrador';
  if (role === 'teacher') return 'Profesor';
  return 'Usuario';
}

export function buildMemberRows(users: MemberRecord[]): MemberRow[] {
  return users.map((user) => ({
    kind: 'member',
    id: user.id,
    name: user.name,
    email: user.email,
    role: getPrimaryRoleLabel(user.roles),
    status: user.isActive ? 'Activo' : 'Inactivo',
  }));
}

export function buildInvitationRows(invitations: InvitationRecord[]): InvitationRow[] {
  return invitations.map((invitation) => ({
    kind: 'invitation',
    id: invitation.id,
    name: invitation.name,
    email: invitation.email,
    role: invitation.role,
    status: 'Pendiente',
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
    left.name.localeCompare(right.name, 'es')
  );

  if (!normalizedQuery) return rows;

  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(normalizedQuery) ||
      row.email.toLowerCase().includes(normalizedQuery)
  );
}

export function getSummaryLabel(totalRows: number): string {
  return totalRows === 0
    ? 'Mostrando 0-0 de 0 usuarios'
    : `Mostrando 1-${totalRows} de ${totalRows} usuarios`;
}

export function getDeliveryNoticeFromInvitationResult({
  email,
  emailSent,
  invitationUrl,
}: {
  email: string;
  emailSent: boolean;
  invitationUrl: string;
}): DeliveryNotice {
  if (emailSent) {
    return {
      tone: 'success',
      title: 'Invitación enviada',
      description: `Se envió la invitación a ${email}.`,
    };
  }

  return {
    tone: 'warning',
    title: 'Invitación creada sin correo',
    description: `Resend no está configurado o no pudo enviar el correo. Comparte este enlace con ${email}.`,
    url: invitationUrl,
  };
}

export function getDeliveryNoticeFromResetResult({
  email,
  emailSent,
  resetUrl,
}: {
  email: string;
  emailSent: boolean;
  resetUrl: string;
}): DeliveryNotice {
  if (emailSent) {
    return {
      tone: 'success',
      title: 'Enlace de recuperación enviado',
      description: `Se envió un correo de recuperación a ${email}.`,
    };
  }

  return {
    tone: 'warning',
    title: 'Recuperación generada sin correo',
    description: `Resend no envió el correo. Comparte este enlace con ${email}.`,
    url: resetUrl,
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
  if (status === 'Pendiente') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'Activo') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
}
