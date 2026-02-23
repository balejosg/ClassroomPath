import React, { useState } from 'react';
import { UserPlus, UserX, Loader2, AlertCircle, Clock, CheckCircle } from 'lucide-react';
import { usePendingUsers, useApproveUser, useRejectUser } from '../lib/hooks';

interface PendingUser {
  userId: string;
  email: string;
  name: string;
  createdAt: string | null;
}

type RoleOption = 'teacher' | 'admin';

const RoleSelector: React.FC<{
  value: RoleOption;
  onChange: (role: RoleOption) => void;
}> = ({ value, onChange }) => {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RoleOption)}
      className="text-xs border border-slate-300 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
    >
      <option value="teacher">Profesor</option>
      <option value="admin">Administrador</option>
    </select>
  );
};

export function PendingUsers() {
  const { data: pendingUsers, isLoading, error, refetch } = usePendingUsers();
  const approveMutation = useApproveUser();
  const rejectMutation = useRejectUser();

  const [selectedRoles, setSelectedRoles] = useState<Record<string, RoleOption>>({});
  const [processingUser, setProcessingUser] = useState<string | null>(null);

  const handleApprove = async (userId: string) => {
    const role = selectedRoles[userId] || 'teacher';
    setProcessingUser(userId);

    try {
      await approveMutation.mutateAsync({ userId, role });
      refetch();
    } catch (err) {
      console.error('Error approving user:', err);
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
      console.error('Error rejecting user:', err);
    } finally {
      setProcessingUser(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Fecha desconocida';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        <span className="ml-3 text-slate-500">Cargando solicitudes pendientes...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-600 font-medium">Error al cargar solicitudes</p>
        <button
          onClick={() => refetch()}
          className="mt-3 text-sm text-red-700 hover:text-red-900 underline"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const users = (pendingUsers as PendingUser[]) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">Solicitudes de Acceso</h2>
        <p className="text-slate-500 text-sm">
          Usuarios esperando aprobación para unirse a tu organización.
        </p>
      </div>

      {/* Content */}
      {users.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-700 mb-2">
            No hay solicitudes pendientes
          </h3>
          <p className="text-slate-500 text-sm">
            Cuando un usuario solicite unirse a tu organización, aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-bold tracking-wider">
                  <th className="px-6 py-4">Usuario</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Solicitado</th>
                  <th className="px-6 py-4">Rol a Asignar</th>
                  <th className="px-6 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.userId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                          <Clock size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                          <p className="text-xs text-slate-400 font-mono">
                            ID: {user.userId.slice(0, 12)}...
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{user.email}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      <RoleSelector
                        value={selectedRoles[user.userId] || 'teacher'}
                        onChange={(role) =>
                          setSelectedRoles((prev) => ({ ...prev, [user.userId]: role }))
                        }
                      />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => void handleApprove(user.userId)}
                          disabled={processingUser === user.userId}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {processingUser === user.userId ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <UserPlus size={14} />
                          )}
                          Aprobar
                        </button>
                        <button
                          onClick={() => void handleReject(user.userId)}
                          disabled={processingUser === user.userId}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <UserX size={14} />
                          Rechazar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">
            {users.length} solicitud{users.length !== 1 ? 'es' : ''} pendiente
            {users.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}

export default PendingUsers;
