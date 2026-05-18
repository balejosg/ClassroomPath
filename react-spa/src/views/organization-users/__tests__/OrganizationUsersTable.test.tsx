import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { OrganizationUsersTable } from '../OrganizationUsersTable';

describe('OrganizationUsersTable', () => {
  it('renders the loading state', () => {
    render(
      <OrganizationUsersTable
        rows={[]}
        isInitialLoading
        hasQueryError={false}
        queryErrorMessage=""
        onRetry={() => {}}
        onRequestReset={() => {}}
        onRequestRevoke={() => {}}
      />
    );

    expect(screen.getByText('Loading users...')).toBeInTheDocument();
  });

  it('renders the retry state and forwards the retry action', () => {
    const onRetry = vi.fn();

    render(
      <OrganizationUsersTable
        rows={[]}
        isInitialLoading={false}
        hasQueryError
        queryErrorMessage="Error al cargar usuarios"
        onRetry={onRetry}
        onRequestReset={() => {}}
        onRequestRevoke={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when there are no rows', () => {
    render(
      <OrganizationUsersTable
        rows={[]}
        isInitialLoading={false}
        hasQueryError={false}
        queryErrorMessage=""
        onRetry={() => {}}
        onRequestReset={() => {}}
        onRequestRevoke={() => {}}
      />
    );

    expect(screen.getByText('No users or invitations to show.')).toBeInTheDocument();
  });

  it('renders member and invitation rows and forwards row actions', () => {
    const onRequestReset = vi.fn();
    const onRequestRevoke = vi.fn();

    const memberRow = {
      kind: 'member' as const,
      id: 'user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'admin' as const,
      status: 'active' as const,
    };

    const invitationRow = {
      kind: 'invitation' as const,
      id: 'inv-1',
      name: 'Grace Hopper',
      email: 'grace@example.com',
      role: 'teacher' as const,
      status: 'pending' as const,
      expiresAt: '2026-03-12T10:00:00.000Z',
    };

    render(
      <OrganizationUsersTable
        rows={[memberRow, invitationRow]}
        isInitialLoading={false}
        hasQueryError={false}
        queryErrorMessage=""
        onRetry={() => {}}
        onRequestReset={onRequestReset}
        onRequestRevoke={onRequestRevoke}
      />
    );

    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getByText('Teacher')).toBeInTheDocument();
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(screen.getByText('GH')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke invitation' }));

    expect(onRequestReset).toHaveBeenCalledWith(memberRow);
    expect(onRequestRevoke).toHaveBeenCalledWith(memberRow);
    expect(onRequestRevoke).toHaveBeenCalledWith(invitationRow);
  });
});
