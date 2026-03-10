import React, { useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { Button } from '@openpath/src/components/ui/Button';
import { ConfirmDialog, DangerConfirmDialog } from '@openpath/src/components/ui/ConfirmDialog';

import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { reportError } from '../lib/reportError';
import {
  DeliveryNotice,
  InviteRole,
  MemberRow,
  TableRow,
  buildInvitationRows,
  buildMemberRows,
  filterOrganizationUserRows,
  getDeliveryNoticeFromInvitationResult,
  getDeliveryNoticeFromResetResult,
  getSummaryLabel,
} from './organization-users-helpers';
import { DeliveryAlert } from './organization-users/DeliveryAlert';
import { InviteUserModal } from './organization-users/InviteUserModal';
import { OrganizationUsersTable } from './organization-users/OrganizationUsersTable';

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

function toRevokeTarget(row: TableRow): RevokeTarget {
  return {
    kind: row.kind,
    id: row.id,
    name: row.name,
    email: row.email,
  };
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

  const memberRows = useMemo(() => buildMemberRows(usersQuery.data ?? []), [usersQuery.data]);
  const invitationRows = useMemo(
    () => buildInvitationRows(invitationsQuery.data ?? []),
    [invitationsQuery.data]
  );

  const filteredRows = useMemo(
    () =>
      filterOrganizationUserRows({
        memberRows,
        invitationRows,
        searchQuery,
      }),
    [invitationRows, memberRows, searchQuery]
  );

  const summaryLabel = getSummaryLabel(filteredRows.length);
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

  const openInviteModal = () => {
    setInviteError('');
    setShowInviteModal(true);
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
      setNotice(getDeliveryNoticeFromInvitationResult(result));
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
      const targetEmail = resetTarget.email;

      setResetTarget(null);
      setNotice(
        getDeliveryNoticeFromResetResult({
          ...result,
          email: targetEmail,
        })
      );
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

        <Button type="button" onClick={openInviteModal} className="gap-2">
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

      <OrganizationUsersTable
        rows={filteredRows}
        isInitialLoading={isInitialLoading}
        hasQueryError={hasQueryError}
        queryErrorMessage={queryErrorMessage}
        onRetry={() => void refetchAll()}
        onRequestReset={(row) => {
          setResetError('');
          setResetTarget(row);
        }}
        onRequestRevoke={(row) => {
          setRevokeError('');
          setRevokeTarget(toRevokeTarget(row));
        }}
      />

      <InviteUserModal
        isOpen={showInviteModal}
        inviteName={inviteName}
        inviteEmail={inviteEmail}
        inviteRole={inviteRole}
        inviteError={inviteError}
        isPending={createInvitationMutation.isPending}
        onInviteNameChange={setInviteName}
        onInviteEmailChange={setInviteEmail}
        onInviteRoleChange={setInviteRole}
        onClose={closeInviteModal}
        onSubmit={(event) => void handleInviteSubmit(event)}
      />

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
