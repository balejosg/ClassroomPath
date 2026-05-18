import React from 'react';
import { UserPlus, UserX, Loader2, AlertCircle, Clock, CheckCircle } from 'lucide-react';
import {
  formatPendingUserDate,
  type RoleOption,
  usePendingUsersState,
} from './pending-users-state';
import type { ClassroomPathT } from '../i18n/classroompath-i18n';

const RoleSelector: React.FC<{
  value: RoleOption;
  onChange: (role: RoleOption) => void;
  t: ClassroomPathT;
}> = ({ value, onChange, t }) => {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RoleOption)}
      className="text-xs border border-slate-300 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
    >
      <option value="teacher">{t('app.common.teacher')}</option>
      <option value="admin">{t('app.common.admin')}</option>
    </select>
  );
};

export function PendingUsers() {
  const state = usePendingUsersState();
  const { t } = state;

  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        <span className="ml-3 text-slate-500">{t('pendingUsers.loading')}</span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-600 font-medium">{t('pendingUsers.loadError')}</p>
        <button
          onClick={() => state.refetch()}
          className="mt-3 text-sm text-red-700 hover:text-red-900 underline"
        >
          {t('app.common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">{t('pendingUsers.title')}</h2>
        <p className="text-slate-500 text-sm">{t('pendingUsers.subtitle')}</p>
      </div>

      {/* Content */}
      {state.users.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-700 mb-2">
            {t('pendingUsers.emptyTitle')}
          </h3>
          <p className="text-slate-500 text-sm">{t('pendingUsers.emptyBody')}</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-bold tracking-wider">
                  <th className="px-6 py-4">{t('pendingUsers.user')}</th>
                  <th className="px-6 py-4">{t('app.common.email')}</th>
                  <th className="px-6 py-4">{t('pendingUsers.requested')}</th>
                  <th className="px-6 py-4">{t('pendingUsers.roleToAssign')}</th>
                  <th className="px-6 py-4 text-right">{t('pendingUsers.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.users.map((user) => (
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
                      {formatPendingUserDate(user.createdAt, t)}
                    </td>
                    <td className="px-6 py-4">
                      <RoleSelector
                        value={state.selectedRoles[user.userId] || 'teacher'}
                        onChange={(role) =>
                          state.setSelectedRoles((prev) => ({ ...prev, [user.userId]: role }))
                        }
                        t={t}
                      />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => void state.handleApprove(user.userId)}
                          disabled={state.processingUser === user.userId}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {state.processingUser === user.userId ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <UserPlus size={14} />
                          )}
                          {t('app.common.approve')}
                        </button>
                        <button
                          onClick={() => void state.handleReject(user.userId)}
                          disabled={state.processingUser === user.userId}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <UserX size={14} />
                          {t('app.common.reject')}
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
            {state.summaryLabel}
          </div>
        </div>
      )}
    </div>
  );
}

export default PendingUsers;
