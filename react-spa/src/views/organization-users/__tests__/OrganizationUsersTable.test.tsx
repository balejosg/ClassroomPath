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

    expect(screen.getByText('Cargando usuarios...')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
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

    expect(screen.getByText('No hay usuarios ni invitaciones para mostrar.')).toBeInTheDocument();
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
      status: 'Activo' as const,
    };

    const invitationRow = {
      kind: 'invitation' as const,
      id: 'inv-1',
      name: 'Grace Hopper',
      email: 'grace@example.com',
      role: 'teacher' as const,
      status: 'Pendiente' as const,
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

    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(screen.getByText('Profesor')).toBeInTheDocument();
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(screen.getByText('GH')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restablecer acceso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revocar acceso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revocar invitación' }));

    expect(onRequestReset).toHaveBeenCalledWith(memberRow);
    expect(onRequestRevoke).toHaveBeenCalledWith(memberRow);
    expect(onRequestRevoke).toHaveBeenCalledWith(invitationRow);
  });
});
