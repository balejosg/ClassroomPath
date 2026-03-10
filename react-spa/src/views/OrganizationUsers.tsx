import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  KeyRound,
  Loader2,
  Mail,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { normalizeUserRoleString } from '@openpath/shared/roles';
import { Button } from '@openpath/src/components/ui/Button';
import { Modal } from '@openpath/src/components/ui/Modal';
import { ConfirmDialog, DangerConfirmDialog } from '@openpath/src/components/ui/ConfirmDialog';

import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { reportError } from '../lib/reportError';

type InviteRole = 'admin' | 'teacher';

type MemberRow = {
  kind: 'member';
  id: string;
  name: string;
  email: string;
  role: InviteRole | 'user';
  status: 'Activo' | 'Inactivo';
};

type InvitationRow = {
  kind: 'invitation';
  id: string;
  name: string;
  email: string;
  role: InviteRole;
  status: 'Pendiente';
  expiresAt: string;
};

type TableRow = MemberRow | InvitationRow;

type DeliveryNotice =
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

type RevokeTarget =
  | {
      kind: 'member';
      id: string;
      name: string;
      email: string;
    }
  | {
      kind: 'invitation';
      id: string;
      name: string;
      email: string;
    };

function getPrimaryRoleLabel(roles: Array<{ role: string }>): InviteRole | 'user' {
  const normalizedRoles = roles
    .map((entry) => normalizeUserRoleString(entry.role))
    .filter((value): value is InviteRole | 'student' => value !== null);

  if (normalizedRoles.includes('admin')) return 'admin';
  if (normalizedRoles.includes('teacher')) return 'teacher';
  return 'user';
}

function getRoleLabel(role: InviteRole | 'user'): string {
  if (role === 'admin') return 'Administrador';
  if (role === 'teacher') return 'Profesor';
  return 'Usuario';
}

function DeliveryAlert({ notice, onDismiss }: { notice: DeliveryNotice; onDismiss: () => void }) {
  const toneClasses =
    notice.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-amber-200 bg-amber-50 text-amber-900';

  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`} role="status">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-sm font-semibold">{notice.title}</p>
          <p className="text-sm">{notice.description}</p>
          {'url' in notice ? (
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wide">
                Enlace manual
              </label>
              <input
                type="text"
                readOnly
                value={notice.url}
                className="w-full rounded-lg border border-current/20 bg-white px-3 py-2 text-xs text-slate-700"
              />
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-semibold uppercase tracking-wide opacity-75 hover:opacity-100"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

export function OrganizationUsers() {
  const usersQuery = cpTrpcReact.users.list.useQuery();
  const invitationsQuery = cpTrpcReact.users.listInvitations.useQuery();

  const createInvitationMutation = cpTrpcReact.users.create.useMutation();
  const revokeInvitationMutation = cpTrpcReact.users.revokeInvitation.useMutation();
  const deleteUserMutation = cpTrpcReact.users.delete.useMutation();
  const resetPasswordMutation = cpTrpcReact.auth.generateResetToken.useMutation();

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('teacher');
  const [inviteError, setInviteError] = useState('');
  const [notice, setNotice] = useState<DeliveryNotice | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);
  const [revokeError, setRevokeError] = useState('');
  const [resetTarget, setResetTarget] = useState<MemberRow | null>(null);
  const [resetError, setResetError] = useState('');

  const refetchAll = async () => {
    await Promise.all([usersQuery.refetch(), invitationsQuery.refetch()]);
  };

  const memberRows: MemberRow[] = useMemo(
    () =>
      (usersQuery.data ?? []).map((user) => ({
        kind: 'member',
        id: user.id,
        name: user.name,
        email: user.email,
        role: getPrimaryRoleLabel(user.roles),
        status: user.isActive ? 'Activo' : 'Inactivo',
      })),
    [usersQuery.data]
  );

  const invitationRows: InvitationRow[] = useMemo(
    () =>
      (invitationsQuery.data ?? []).map((invitation) => ({
        kind: 'invitation',
        id: invitation.id,
        name: invitation.name,
        email: invitation.email,
        role: invitation.role,
        status: 'Pendiente',
        expiresAt: invitation.expiresAt,
      })),
    [invitationsQuery.data]
  );

  const filteredRows = useMemo(() => {
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
  }, [invitationRows, memberRows, searchQuery]);

  const totalRows = filteredRows.length;
  const summaryLabel =
    totalRows === 0
      ? 'Mostrando 0-0 de 0 usuarios'
      : `Mostrando 1-${totalRows} de ${totalRows} usuarios`;

  const isInitialLoading =
    (usersQuery.isLoading || invitationsQuery.isLoading) &&
    !usersQuery.data &&
    !invitationsQuery.data;
  const hasQueryError =
    (usersQuery.isError && !usersQuery.data) ||
    (invitationsQuery.isError && !invitationsQuery.data);
  const queryErrorMessage =
    usersQuery.error?.message ?? invitationsQuery.error?.message ?? 'Error al cargar usuarios';

  const closeInviteModal = () => {
    if (createInvitationMutation.isPending) return;
    setShowInviteModal(false);
    setInviteError('');
  };

  const handleInviteSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInviteError('');
    setNotice(null);

    try {
      const result = await createInvitationMutation.mutateAsync({
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        role: inviteRole,
      });

      await refetchAll();

      setShowInviteModal(false);
      setInviteName('');
      setInviteEmail('');
      setInviteRole('teacher');

      if (result.emailSent) {
        setNotice({
          tone: 'success',
          title: 'Invitación enviada',
          description: `Se envió la invitación a ${result.email}.`,
        });
        return;
      }

      setNotice({
        tone: 'warning',
        title: 'Invitación creada sin correo',
        description: `Resend no está configurado o no pudo enviar el correo. Comparte este enlace con ${result.email}.`,
        url: result.invitationUrl,
      });
    } catch (error) {
      reportError('Failed to create organization invitation', error);
      setInviteError(error instanceof Error ? error.message : 'No se pudo crear la invitación');
    }
  };

  const handleConfirmRevoke = async () => {
    if (!revokeTarget) return;

    try {
      setNotice(null);
      if (revokeTarget.kind === 'invitation') {
        await revokeInvitationMutation.mutateAsync({ invitationId: revokeTarget.id });
      } else {
        await deleteUserMutation.mutateAsync({ id: revokeTarget.id });
      }

      await refetchAll();
      setRevokeError('');
      setRevokeTarget(null);
    } catch (error) {
      reportError('Failed to revoke organization access', error);
      setRevokeError(
        error instanceof Error ? error.message : 'No se pudo revocar el acceso seleccionado'
      );
    }
  };

  const handleGenerateReset = async () => {
    if (!resetTarget) return;

    setResetError('');
    setNotice(null);

    try {
      const result = await resetPasswordMutation.mutateAsync({ email: resetTarget.email });
      setResetTarget(null);

      if (result.emailSent) {
        setNotice({
          tone: 'success',
          title: 'Enlace de recuperación enviado',
          description: `Se envió un correo de recuperación a ${resetTarget.email}.`,
        });
        return;
      }

      setNotice({
        tone: 'warning',
        title: 'Recuperación generada sin correo',
        description: `Resend no envió el correo. Comparte este enlace con ${resetTarget.email}.`,
        url: result.resetUrl,
      });
    } catch (error) {
      reportError('Failed to generate tenant reset token', error);
      setResetError(
        error instanceof Error ? error.message : 'No se pudo generar el enlace de recuperación'
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Gestión de Usuarios</h2>
          <p className="text-sm text-slate-500">
            Invita nuevos miembros, revoca accesos y genera recuperaciones sin pedir contraseñas.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => {
            setInviteError('');
            setShowInviteModal(true);
          }}
          className="gap-2"
        >
          <UserPlus size={16} />
          Invitar usuario
        </Button>
      </div>

      {notice ? <DeliveryAlert notice={notice} onDismiss={() => setNotice(null)} /> : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-md">
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar por nombre o correo"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white"
            />
          </label>

          <p data-testid="users-summary" className="text-sm text-slate-500">
            {summaryLabel}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table data-testid="users-table" className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-4">Usuario</th>
                <th className="px-6 py-4">Correo</th>
                <th className="px-6 py-4">Rol</th>
                <th className="px-6 py-4">Estado</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isInitialLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                    <span className="mt-2 block text-sm text-slate-500">Cargando usuarios...</span>
                  </td>
                </tr>
              ) : hasQueryError ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center">
                    <AlertCircle className="mx-auto h-6 w-6 text-red-400" />
                    <span className="mt-2 block text-sm text-red-600">{queryErrorMessage}</span>
                    <button
                      type="button"
                      onClick={() => void refetchAll()}
                      className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-800"
                    >
                      Reintentar
                    </button>
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-500">
                    No hay usuarios ni invitaciones para mostrar.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const statusClasses =
                    row.status === 'Pendiente'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : row.status === 'Activo'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-100 text-slate-600';

                  return (
                    <tr key={`${row.kind}-${row.id}`} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700">
                            {row.name
                              .split(' ')
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((segment) => segment[0])
                              .join('')
                              .toUpperCase() || '??'}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                            {row.kind === 'invitation' ? (
                              <p className="text-xs text-slate-400">
                                Invitación válida hasta{' '}
                                {new Date(row.expiresAt).toLocaleString('es-ES')}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                          <Mail size={14} className="text-slate-400" />
                          <span>{row.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700">{getRoleLabel(row.role)}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          {row.kind === 'member' ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => {
                                  setResetError('');
                                  setResetTarget(row);
                                }}
                              >
                                <KeyRound size={14} />
                                Restablecer acceso
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                                onClick={() => {
                                  setRevokeError('');
                                  setRevokeTarget({
                                    kind: 'member',
                                    id: row.id,
                                    name: row.name,
                                    email: row.email,
                                  });
                                }}
                              >
                                <Trash2 size={14} />
                                Revocar acceso
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => {
                                setRevokeError('');
                                setRevokeTarget({
                                  kind: 'invitation',
                                  id: row.id,
                                  name: row.name,
                                  email: row.email,
                                });
                              }}
                            >
                              <Trash2 size={14} />
                              Revocar invitación
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={showInviteModal} onClose={closeInviteModal} title="Invitar usuario">
        <form onSubmit={(event) => void handleInviteSubmit(event)} className="space-y-5">
          <div>
            <label
              htmlFor="invite-name"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Nombre
            </label>
            <input
              id="invite-name"
              type="text"
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
              placeholder="Nombre completo"
              required
              disabled={createInvitationMutation.isPending}
              className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label
              htmlFor="invite-email"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Correo electrónico
            </label>
            <input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="usuario@dominio.com"
              required
              disabled={createInvitationMutation.isPending}
              className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label
              htmlFor="invite-role"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Rol
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as InviteRole)}
              disabled={createInvitationMutation.isPending}
              className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="teacher">Profesor</option>
              <option value="admin">Administrador</option>
            </select>
          </div>

          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
            La contraseña no se define aquí. El usuario la creará al aceptar su invitación.
          </div>

          {inviteError ? (
            <div
              className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              {inviteError}
            </div>
          ) : null}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={closeInviteModal}
              disabled={createInvitationMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="flex-1 gap-2"
              isLoading={createInvitationMutation.isPending}
            >
              <ShieldCheck size={16} />
              Enviar invitación
            </Button>
          </div>
        </form>
      </Modal>

      <DangerConfirmDialog
        isOpen={revokeTarget !== null}
        title={revokeTarget?.kind === 'invitation' ? 'Revocar invitación' : 'Revocar acceso'}
        confirmLabel={revokeTarget?.kind === 'invitation' ? 'Revocar invitación' : 'Revocar acceso'}
        isLoading={revokeInvitationMutation.isPending || deleteUserMutation.isPending}
        errorMessage={revokeError || undefined}
        onClose={() => {
          setRevokeTarget(null);
          setRevokeError('');
        }}
        onConfirm={() => void handleConfirmRevoke()}
      >
        <p className="text-sm text-slate-600">
          {revokeTarget?.kind === 'invitation'
            ? `Se eliminará la invitación pendiente de ${revokeTarget?.email}.`
            : `Se quitará el acceso de ${revokeTarget?.email} a esta organización.`}
        </p>
      </DangerConfirmDialog>

      <ConfirmDialog
        isOpen={resetTarget !== null}
        title="Generar recuperación"
        confirmLabel="Generar enlace"
        isLoading={resetPasswordMutation.isPending}
        errorMessage={resetError || undefined}
        onClose={() => {
          if (resetPasswordMutation.isPending) return;
          setResetTarget(null);
          setResetError('');
        }}
        onConfirm={() => void handleGenerateReset()}
      >
        <p className="text-sm text-slate-600">
          Se generará un enlace de recuperación para <strong>{resetTarget?.email}</strong>.
        </p>
      </ConfirmDialog>
    </div>
  );
}
