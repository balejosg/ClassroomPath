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
  const { t } = state;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('orgUsers.title')}</h2>
          <p className="text-sm text-slate-500">{t('orgUsers.subtitle')}</p>
        </div>

        <Button type="button" onClick={state.openInviteModal} className="gap-2">
          <UserPlus size={16} />
          {t('orgUsers.inviteUser')}
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
              placeholder={t('orgUsers.searchPlaceholder')}
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
        t={t}
        locale={state.locale}
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
        t={t}
      />

      <DangerConfirmDialog
        isOpen={state.revokeTarget !== null}
        title={
          state.revokeTarget?.kind === 'invitation'
            ? t('orgUsers.revokeInvitation')
            : t('orgUsers.revokeAccess')
        }
        confirmLabel={
          state.revokeTarget?.kind === 'invitation'
            ? t('orgUsers.revokeInvitation')
            : t('orgUsers.revokeAccess')
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
            ? t('orgUsers.revokeInvitationBody', { email: state.revokeTarget?.email ?? '' })
            : t('orgUsers.revokeAccessBody', { email: state.revokeTarget?.email ?? '' })}
        </p>
      </DangerConfirmDialog>

      <ConfirmDialog
        isOpen={state.resetTarget !== null}
        title={t('orgUsers.generateRecovery')}
        confirmLabel={t('orgUsers.generateLink')}
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
          {t('orgUsers.generateRecoveryBody', { email: state.resetTarget?.email ?? '' })}
        </p>
      </ConfirmDialog>
    </div>
  );
}
