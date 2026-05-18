import { AlertCircle, KeyRound, Loader2, Mail, Trash2 } from 'lucide-react';
import { Button } from '../../openpath/public-ui';

import {
  MemberRow,
  TableRow,
  getRoleLabel,
  getRowInitials,
  getStatusClasses,
} from '../organization-users-helpers';
import { translateClassroomPathText, type ClassroomPathT } from '../../i18n/classroompath-i18n';

const defaultT: ClassroomPathT = (key, values) => translateClassroomPathText('en', key, values);

export function OrganizationUsersTable({
  rows,
  isInitialLoading,
  hasQueryError,
  queryErrorMessage,
  onRetry,
  onRequestReset,
  onRequestRevoke,
  t = defaultT,
}: {
  rows: TableRow[];
  isInitialLoading: boolean;
  hasQueryError: boolean;
  queryErrorMessage: string;
  onRetry: () => void;
  onRequestReset: (row: MemberRow) => void;
  onRequestRevoke: (row: TableRow) => void;
  t?: ClassroomPathT;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table data-testid="users-table" className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-6 py-4">{t('orgUsers.table.user')}</th>
              <th className="px-6 py-4">{t('orgUsers.table.email')}</th>
              <th className="px-6 py-4">{t('app.common.role')}</th>
              <th className="px-6 py-4">{t('orgUsers.table.status')}</th>
              <th className="px-6 py-4 text-right">{t('pendingUsers.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isInitialLoading ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                  <span className="mt-2 block text-sm text-slate-500">
                    {t('orgUsers.table.loading')}
                  </span>
                </td>
              </tr>
            ) : hasQueryError ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center">
                  <AlertCircle className="mx-auto h-6 w-6 text-red-400" />
                  <span className="mt-2 block text-sm text-red-600">{queryErrorMessage}</span>
                  <button
                    type="button"
                    onClick={onRetry}
                    className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-800"
                  >
                    {t('app.common.retry')}
                  </button>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-500">
                  {t('orgUsers.table.empty')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.kind}-${row.id}`} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700">
                        {getRowInitials(row.name)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                        {row.kind === 'invitation' ? (
                          <p className="text-xs text-slate-400">
                            {t('orgUsers.table.invitationValidUntil')}{' '}
                            {new Date(row.expiresAt).toLocaleString('en-US')}
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
                  <td className="px-6 py-4 text-sm text-slate-700">{getRoleLabel(row.role, t)}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClasses(row.status)}`}
                    >
                      {row.status === 'pending'
                        ? t('orgUsers.statusPending')
                        : row.status === 'active'
                          ? t('app.common.active')
                          : t('app.common.inactive')}
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
                            onClick={() => onRequestReset(row)}
                          >
                            <KeyRound size={14} />
                            {t('orgUsers.table.resetAccess')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => onRequestRevoke(row)}
                          >
                            <Trash2 size={14} />
                            {t('orgUsers.revokeAccess')}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => onRequestRevoke(row)}
                        >
                          <Trash2 size={14} />
                          {t('orgUsers.revokeInvitation')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
