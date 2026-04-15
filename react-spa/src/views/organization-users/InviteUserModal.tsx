import { ShieldCheck } from 'lucide-react';
import { Button, Modal } from '../../openpath/public-ui';

import { InviteRole } from '../organization-users-helpers';

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
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Invitar usuario">
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label htmlFor="invite-name" className="mb-2 block text-sm font-semibold text-slate-700">
            Nombre
          </label>
          <input
            id="invite-name"
            type="text"
            value={inviteName}
            onChange={(event) => onInviteNameChange(event.target.value)}
            placeholder="Nombre completo"
            required
            disabled={isPending}
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div>
          <label htmlFor="invite-email" className="mb-2 block text-sm font-semibold text-slate-700">
            Correo electrónico
          </label>
          <input
            id="invite-email"
            type="email"
            value={inviteEmail}
            onChange={(event) => onInviteEmailChange(event.target.value)}
            placeholder="usuario@dominio.com"
            required
            disabled={isPending}
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div>
          <label htmlFor="invite-role" className="mb-2 block text-sm font-semibold text-slate-700">
            Rol
          </label>
          <select
            id="invite-role"
            value={inviteRole}
            onChange={(event) => onInviteRoleChange(event.target.value as InviteRole)}
            disabled={isPending}
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
            onClick={onClose}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" className="flex-1 gap-2" isLoading={isPending}>
            <ShieldCheck size={16} />
            Enviar invitación
          </Button>
        </div>
      </form>
    </Modal>
  );
}
