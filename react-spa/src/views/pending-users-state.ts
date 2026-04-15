import { useState } from 'react';

import { useApproveUser, usePendingUsers, useRejectUser } from '../lib/hooks';
import { reportError } from '../lib/reportError';

export interface PendingUser {
  userId: string;
  email: string;
  name: string;
  createdAt: string | null;
}

export type RoleOption = 'teacher' | 'admin';

export function formatPendingUserDate(dateStr: string | null): string {
  if (!dateStr) return 'Fecha desconocida';

  const date = new Date(dateStr);
  return date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getPendingUsersSummaryLabel(count: number): string {
  return `${count} solicitud${count !== 1 ? 'es' : ''} pendiente${count !== 1 ? 's' : ''}`;
}

export function usePendingUsersState() {
  const { data: pendingUsers, isLoading, error, refetch } = usePendingUsers();
  const approveMutation = useApproveUser();
  const rejectMutation = useRejectUser();

  const [selectedRoles, setSelectedRoles] = useState<Record<string, RoleOption>>({});
  const [processingUser, setProcessingUser] = useState<string | null>(null);

  const users = (pendingUsers as PendingUser[]) || [];

  const handleApprove = async (userId: string) => {
    const role = selectedRoles[userId] || 'teacher';
    setProcessingUser(userId);

    try {
      await approveMutation.mutateAsync({ userId, role });
      refetch();
    } catch (err) {
      reportError('Error approving user', err, {
        action: 'approve-pending-user',
        userRole: 'admin',
        targetUserId: userId,
        assignedRole: role,
      });
    } finally {
      setProcessingUser(null);
    }
  };

  const handleReject = async (userId: string) => {
    if (!confirm('¿Estás seguro de que quieres rechazar esta solicitud?')) return;

    setProcessingUser(userId);
    try {
      await rejectMutation.mutateAsync({ userId });
      refetch();
    } catch (err) {
      reportError('Error rejecting user', err, {
        action: 'reject-pending-user',
        userRole: 'admin',
        targetUserId: userId,
      });
    } finally {
      setProcessingUser(null);
    }
  };

  return {
    users,
    isLoading,
    error,
    refetch,
    processingUser,
    selectedRoles,
    setSelectedRoles,
    handleApprove,
    handleReject,
    summaryLabel: getPendingUsersSummaryLabel(users.length),
  };
}
