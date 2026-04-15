import React from 'react';
import { Search, UserPlus } from 'lucide-react';
import { Button, ConfirmDialog, DangerConfirmDialog } from '../openpath/public-ui';

import { DeliveryAlert } from './organization-users/DeliveryAlert';
import { InviteUserModal } from './organization-users/InviteUserModal';
import { OrganizationUsersTable } from './organization-users/OrganizationUsersTable';
import {
  toRevokeTarget,
  useOrganizationUsersState,
} from './organization-users/useOrganizationUsersState';

export function OrganizationUsers() {
  const state = useOrganizationUsersState();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Gestión de Usuarios</h2>
          <p className="text-sm text-slate-500">
            Invita nuevos miembros, revoca accesos y genera recuperaciones sin pedir contraseñas.
          </p>
        </div>

        <Button type="button" onClick={state.openInviteModal} className="gap-2">
          <UserPlus size={16} />
          Invitar usuario
        </Button>
      </div>

      {state.notice ? (
        <DeliveryAlert notice={state.notice} onDismiss={() => state.setNotice(null)} />
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-md">
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
            />
            <input
              type="text"
              value={state.searchQuery}
              onChange={(event) => state.setSearchQuery(event.target.value)}
              placeholder="Buscar por nombre o correo"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white"
            />
          </label>

          <p data-testid="users-summary" className="text-sm text-slate-500">
            {state.summaryLabel}
          </p>
        </div>
      </div>

      <OrganizationUsersTable
        rows={state.filteredRows}
        isInitialLoading={state.isInitialLoading}
        hasQueryError={state.hasQueryError}
        queryErrorMessage={state.queryErrorMessage}
        onRetry={() => void state.refetchAll()}
        onRequestReset={(row) => {
          state.setResetError('');
          state.setResetTarget(row);
        }}
        onRequestRevoke={(row) => {
          state.setRevokeError('');
          state.setRevokeTarget(toRevokeTarget(row));
        }}
      />

      <InviteUserModal
        isOpen={state.showInviteModal}
        inviteName={state.inviteName}
        inviteEmail={state.inviteEmail}
        inviteRole={state.inviteRole}
        inviteError={state.inviteError}
        isPending={state.createInvitationMutation.isPending}
        onInviteNameChange={state.setInviteName}
        onInviteEmailChange={state.setInviteEmail}
        onInviteRoleChange={state.setInviteRole}
        onClose={state.closeInviteModal}
        onSubmit={(event) => void state.handleInviteSubmit(event)}
      />

      <DangerConfirmDialog
        isOpen={state.revokeTarget !== null}
        title={state.revokeTarget?.kind === 'invitation' ? 'Revocar invitación' : 'Revocar acceso'}
        confirmLabel={
          state.revokeTarget?.kind === 'invitation' ? 'Revocar invitación' : 'Revocar acceso'
        }
        isLoading={state.revokeInvitationMutation.isPending || state.deleteUserMutation.isPending}
        errorMessage={state.revokeError || undefined}
        onClose={() => {
          state.setRevokeTarget(null);
          state.setRevokeError('');
        }}
        onConfirm={() => void state.handleConfirmRevoke()}
      >
        <p className="text-sm text-slate-600">
          {state.revokeTarget?.kind === 'invitation'
            ? `Se eliminará la invitación pendiente de ${state.revokeTarget?.email}.`
            : `Se quitará el acceso de ${state.revokeTarget?.email} a esta organización.`}
        </p>
      </DangerConfirmDialog>

      <ConfirmDialog
        isOpen={state.resetTarget !== null}
        title="Generar recuperación"
        confirmLabel="Generar enlace"
        isLoading={state.resetPasswordMutation.isPending}
        errorMessage={state.resetError || undefined}
        onClose={() => {
          if (state.resetPasswordMutation.isPending) return;
          state.setResetTarget(null);
          state.setResetError('');
        }}
        onConfirm={() => void state.handleGenerateReset()}
      >
        <p className="text-sm text-slate-600">
          Se generará un enlace de recuperación para <strong>{state.resetTarget?.email}</strong>.
        </p>
      </ConfirmDialog>
    </div>
  );
}
