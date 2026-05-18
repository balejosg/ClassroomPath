import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { InviteUserModal } from '../InviteUserModal';

describe('InviteUserModal', () => {
  it('renders the invite form without a password field and forwards input changes', () => {
    const onInviteNameChange = vi.fn();
    const onInviteEmailChange = vi.fn();
    const onInviteRoleChange = vi.fn();
    const onClose = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());

    render(
      <InviteUserModal
        isOpen
        inviteName=""
        inviteEmail=""
        inviteRole="teacher"
        inviteError=""
        isPending={false}
        onInviteNameChange={onInviteNameChange}
        onInviteEmailChange={onInviteEmailChange}
        onInviteRoleChange={onInviteRoleChange}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Send invitation' }).closest('form')!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onInviteNameChange).toHaveBeenCalledWith('Ada Lovelace');
    expect(onInviteEmailChange).toHaveBeenCalledWith('ada@example.com');
    expect(onInviteRoleChange).toHaveBeenCalledWith('admin');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/Password/i)).not.toBeInTheDocument();
  });

  it('renders invite errors and disables the form while pending', () => {
    render(
      <InviteUserModal
        isOpen
        inviteName="Ada"
        inviteEmail="ada@example.com"
        inviteRole="teacher"
        inviteError="Domain is not allowed"
        isPending
        onInviteNameChange={() => {}}
        onInviteEmailChange={() => {}}
        onInviteRoleChange={() => {}}
        onClose={() => {}}
        onSubmit={(event) => event.preventDefault()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Domain is not allowed');
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
