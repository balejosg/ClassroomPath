import { useMemo, useState } from 'react';

import { cpTrpcReact } from '../../lib/dual-trpc-provider';
import { reportError } from '../../lib/reportError';
import {
  type DeliveryNotice,
  type InviteRole,
  type InvitationRecord,
  type MemberRow,
  type MemberRecord,
  type TableRow,
  buildInvitationRows,
  buildMemberRows,
  filterOrganizationUserRows,
  getDeliveryNoticeFromInvitationResult,
  getDeliveryNoticeFromResetResult,
  getSummaryLabel,
} from '../organization-users-helpers';
import { useClassroomPathT, type ClassroomPathT } from '../../i18n/classroompath-i18n';

export type RevokeTarget =
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

export function toRevokeTarget(row: TableRow): RevokeTarget {
  return {
    kind: row.kind,
    id: row.id,
    name: row.name,
    email: row.email,
  };
}

export function buildOrganizationUsersQueryState(args: {
  users: MemberRecord[] | undefined;
  invitations: InvitationRecord[] | undefined;
  searchQuery: string;
  usersLoading: boolean;
  invitationsLoading: boolean;
  usersError?: { message?: string } | null;
  invitationsError?: { message?: string } | null;
  usersErrored: boolean;
  invitationsErrored: boolean;
  t?: ClassroomPathT;
}) {
  const memberRows = buildMemberRows(args.users ?? []);
  const invitationRows = buildInvitationRows(args.invitations ?? []);
  const filteredRows = filterOrganizationUserRows({
    memberRows,
    invitationRows,
    searchQuery: args.searchQuery,
  });

  return {
    filteredRows,
    summaryLabel: getSummaryLabel(filteredRows.length, args.t),
    isInitialLoading:
      (args.usersLoading || args.invitationsLoading) && !args.users && !args.invitations,
    hasQueryError:
      (args.usersErrored && !args.users) || (args.invitationsErrored && !args.invitations),
    queryErrorMessage:
      args.usersError?.message ??
      args.invitationsError?.message ??
      args.t?.('orgUsers.loadError') ??
      'Could not load users',
  };
}

export function useOrganizationUsersState() {
  const t = useClassroomPathT();
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

  const queryState = useMemo(
    () =>
      buildOrganizationUsersQueryState({
        users: usersQuery.data,
        invitations: invitationsQuery.data,
        searchQuery,
        usersLoading: usersQuery.isLoading,
        invitationsLoading: invitationsQuery.isLoading,
        usersError: usersQuery.error,
        invitationsError: invitationsQuery.error,
        usersErrored: usersQuery.isError,
        invitationsErrored: invitationsQuery.isError,
        t,
      }),
    [
      invitationsQuery.data,
      invitationsQuery.error,
      invitationsQuery.isError,
      invitationsQuery.isLoading,
      searchQuery,
      usersQuery.data,
      usersQuery.error,
      usersQuery.isError,
      usersQuery.isLoading,
      t,
    ]
  );

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

      setShowInviteModal(false);
      setInviteName('');
      setInviteEmail('');
      setInviteRole('teacher');
      setNotice(getDeliveryNoticeFromInvitationResult({ ...result, t }));
      void refetchAll().catch((error) => {
        reportError('Failed to refresh organization users after invitation', error);
      });
    } catch (error) {
      reportError('Failed to create organization invitation', error);
      setInviteError(error instanceof Error ? error.message : t('orgUsers.inviteFailed'));
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
      setRevokeError(error instanceof Error ? error.message : t('orgUsers.revokeFailed'));
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
          t,
        })
      );
    } catch (error) {
      reportError('Failed to generate tenant reset token', error);
      setResetError(error instanceof Error ? error.message : t('orgUsers.resetFailed'));
    }
  };

  return {
    createInvitationMutation,
    revokeInvitationMutation,
    deleteUserMutation,
    resetPasswordMutation,
    showInviteModal,
    inviteName,
    inviteEmail,
    inviteRole,
    inviteError,
    notice,
    searchQuery,
    revokeTarget,
    revokeError,
    resetTarget,
    resetError,
    filteredRows: queryState.filteredRows,
    summaryLabel: queryState.summaryLabel,
    isInitialLoading: queryState.isInitialLoading,
    hasQueryError: queryState.hasQueryError,
    queryErrorMessage: queryState.queryErrorMessage,
    refetchAll,
    closeInviteModal,
    openInviteModal,
    handleInviteSubmit,
    handleConfirmRevoke,
    handleGenerateReset,
    setInviteName,
    setInviteEmail,
    setInviteRole,
    setNotice,
    setSearchQuery,
    setRevokeTarget,
    setRevokeError,
    setResetTarget,
    setResetError,
    t,
  };
}
