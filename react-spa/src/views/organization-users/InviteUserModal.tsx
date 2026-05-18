import { ShieldCheck } from 'lucide-react';
import { Button, Modal } from '../../openpath/public-ui';

import { InviteRole } from '../organization-users-helpers';
import { translateClassroomPathText, type ClassroomPathT } from '../../i18n/classroompath-i18n';

const defaultT: ClassroomPathT = (key, values) => translateClassroomPathText('en', key, values);

export function InviteUserModal({
  isOpen,
  inviteName,
  inviteEmail,
  inviteRole,
  inviteError,
  isPending,
  onInviteNameChange,
  onInviteEmailChange,
  onInviteRoleChange,
  onClose,
  onSubmit,
  t = defaultT,
}: {
  isOpen: boolean;
  inviteName: string;
  inviteEmail: string;
  inviteRole: InviteRole;
  inviteError: string;
  isPending: boolean;
  onInviteNameChange: (value: string) => void;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (role: InviteRole) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  t?: ClassroomPathT;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('orgUsers.inviteUser')}>
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label htmlFor="invite-name" className="mb-2 block text-sm font-semibold text-slate-700">
            {t('app.common.name')}
          </label>
          <input
            id="invite-name"
            type="text"
            value={inviteName}
            onChange={(event) => onInviteNameChange(event.target.value)}
            placeholder={t('orgUsers.invite.fullNamePlaceholder')}
            required
            disabled={isPending}
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div>
          <label htmlFor="invite-email" className="mb-2 block text-sm font-semibold text-slate-700">
            {t('auth.email.label')}
          </label>
          <input
            id="invite-email"
            type="email"
            value={inviteEmail}
            onChange={(event) => onInviteEmailChange(event.target.value)}
            placeholder={t('orgUsers.invite.emailPlaceholder')}
            required
            disabled={isPending}
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div>
          <label htmlFor="invite-role" className="mb-2 block text-sm font-semibold text-slate-700">
            {t('app.common.role')}
          </label>
          <select
            id="invite-role"
            value={inviteRole}
            onChange={(event) => onInviteRoleChange(event.target.value as InviteRole)}
            disabled={isPending}
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="teacher">{t('app.common.teacher')}</option>
            <option value="admin">{t('app.common.admin')}</option>
          </select>
        </div>

        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
          {t('orgUsers.invite.passwordNote')}
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
            onClick={onClose}
            disabled={isPending}
          >
            {t('app.common.cancel')}
          </Button>
          <Button type="submit" className="flex-1 gap-2" isLoading={isPending}>
            <ShieldCheck size={16} />
            {t('orgUsers.invite.send')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
