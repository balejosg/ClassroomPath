import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OnboardingStatusDto } from '@classroompath/presenters/onboarding';

import { OnboardingAccessGate } from '../OnboardingAccessGate';

vi.mock('../../views/Waiting', () => ({
  Waiting: ({
    onStatusChange,
    onCancelSuccess,
    onLogout,
  }: {
    onStatusChange: () => void;
    onCancelSuccess: () => void;
    onLogout: () => void;
  }) => (
    <div>
      <div>Waiting View</div>
      <button onClick={onStatusChange}>Refresh waiting</button>
      <button onClick={onCancelSuccess}>Cancel waiting</button>
      <button onClick={onLogout}>Logout waiting</button>
    </div>
  ),
}));

vi.mock('../../views/Onboarding', () => ({
  Onboarding: ({
    onOrgCreated,
    onWaitClick,
    onLogout,
  }: {
    onOrgCreated: (result: { user: { id: string } }) => void;
    onWaitClick: () => void;
    onLogout: () => void;
  }) => (
    <div>
      <div>Onboarding View</div>
      <button onClick={() => onOrgCreated({ user: { id: 'user-1' } })}>Crear org</button>
      <button onClick={onWaitClick}>Ir a waiting</button>
      <button onClick={onLogout}>Logout onboarding</button>
    </div>
  ),
}));

vi.mock('../../components/PlatformAdminPanel', () => ({
  PlatformAdminPanel: () => <div>Platform Admin Panel</div>,
}));

function activeBilling(
  overrides: Partial<NonNullable<OnboardingStatusDto['billing']>> = {}
): NonNullable<OnboardingStatusDto['billing']> {
  return {
    hasActiveEntitlement: true,
    source: 'stripe_subscription',
    status: 'active',
    productKind: 'annual',
    classroomLimit: 12,
    currentPeriodEnd: null,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    expiresAt: null,
    ...overrides,
  };
}

function createStatus(overrides: Partial<OnboardingStatusDto> = {}): OnboardingStatusDto {
  return {
    hasMembership: true,
    isWaiting: false,
    organization: null,
    platformAdmin: false,
    billing: activeBilling(),
    policy: {
      allowOrgDirectory: false,
      allowSelfServiceOrgs: false,
      billingMode: 'stripe',
    },
    ...overrides,
  };
}

function renderGate(overrides?: Partial<React.ComponentProps<typeof OnboardingAccessGate>>) {
  const props: React.ComponentProps<typeof OnboardingAccessGate> = {
    status: createStatus(),
    isLoading: false,
    loadingTimedOut: false,
    isError: false,
    isAcceptingPendingInvitation: false,
    onRetry: () => undefined,
    onLogoutToLogin: () => undefined,
    onAcceptPendingInvitation: () => undefined,
    onDismissPendingInvitation: () => undefined,
    onStatusChange: () => undefined,
    onCancelWaitingSuccess: () => undefined,
    onOrgCreated: () => undefined,
    authenticatedContent: <div>Shell View</div>,
    ...overrides,
  };

  return render(<OnboardingAccessGate {...props} />);
}

describe('OnboardingAccessGate', () => {
  it('shows loading, timeout, and error states', () => {
    const onRetry = vi.fn();
    const onLogoutToLogin = vi.fn();

    const { rerender } = renderGate({ isLoading: true });
    expect(screen.getByText('Verificando estado...')).toBeInTheDocument();

    rerender(
      <OnboardingAccessGate
        status={createStatus({ hasMembership: true })}
        isLoading
        loadingTimedOut
        isError={false}
        onRetry={onRetry}
        onLogoutToLogin={onLogoutToLogin}
        onStatusChange={() => undefined}
        onCancelWaitingSuccess={() => undefined}
        onOrgCreated={() => undefined}
        authenticatedContent={<div>Shell View</div>}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver a login' }));

    rerender(
      <OnboardingAccessGate
        status={undefined}
        isLoading={false}
        loadingTimedOut={false}
        isError
        onRetry={onRetry}
        onLogoutToLogin={onLogoutToLogin}
        onStatusChange={() => undefined}
        onCancelWaitingSuccess={() => undefined}
        onOrgCreated={() => undefined}
        authenticatedContent={<div>Shell View</div>}
      />
    );

    expect(screen.getByText('No se pudo verificar tu acceso')).toBeInTheDocument();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onLogoutToLogin).toHaveBeenCalledTimes(1);
  });

  it('preserves authenticated content when a transient status error happens after access was already resolved', () => {
    renderGate({
      status: createStatus({ hasMembership: true }),
      isError: true,
      authenticatedContent: <div>Authenticated Shell</div>,
    });

    expect(screen.getByText('Authenticated Shell')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo verificar tu acceso')).not.toBeInTheDocument();
  });

  it('routes waiting and onboarding states through their callbacks', () => {
    const onStatusChange = vi.fn();
    const onCancelWaitingSuccess = vi.fn();
    const onLogoutToLogin = vi.fn();
    const onOrgCreated = vi.fn();

    const { rerender } = renderGate({
      status: createStatus({ hasMembership: false, isWaiting: true }),
      onStatusChange,
      onCancelWaitingSuccess,
      onLogoutToLogin,
      onOrgCreated,
    });

    expect(screen.getByText('Waiting View')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh waiting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel waiting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Logout waiting' }));

    rerender(
      <OnboardingAccessGate
        status={createStatus({ hasMembership: false, isWaiting: false })}
        isLoading={false}
        loadingTimedOut={false}
        isError={false}
        onRetry={() => undefined}
        onLogoutToLogin={onLogoutToLogin}
        onStatusChange={onStatusChange}
        onCancelWaitingSuccess={onCancelWaitingSuccess}
        onOrgCreated={onOrgCreated}
        authenticatedContent={<div>Shell View</div>}
      />
    );

    expect(screen.getByText('Onboarding View')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear org' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ir a waiting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Logout onboarding' }));

    expect(onStatusChange).toHaveBeenCalledTimes(2);
    expect(onCancelWaitingSuccess).toHaveBeenCalledTimes(1);
    expect(onLogoutToLogin).toHaveBeenCalledTimes(2);
    expect(onOrgCreated).toHaveBeenCalledWith({ user: { id: 'user-1' } });
  });

  it('shows a migration confirmation instead of the waiting room when there is a pending transfer invitation', () => {
    const onAcceptPendingInvitation = vi.fn();
    const onDismissPendingInvitation = vi.fn();

    renderGate({
      status: createStatus({
        hasMembership: true,
        isWaiting: true,
        organization: {
          id: 'org-current',
          name: 'Colegio Actual',
          role: 'teacher',
        },
        pendingInvitation: {
          organizationId: 'org-next',
          organizationName: 'Colegio Nuevo',
          role: 'teacher',
          requiresMigration: true,
        },
      }),
      onAcceptPendingInvitation,
      onDismissPendingInvitation,
      authenticatedContent: <div>Authenticated Shell</div>,
    });

    expect(screen.getByText('Tienes una invitación pendiente')).toBeInTheDocument();
    expect(screen.getByText('Organización actual: Colegio Actual')).toBeInTheDocument();
    expect(screen.getByText('Nueva organización: Colegio Nuevo')).toBeInTheDocument();
    expect(screen.queryByText('Waiting View')).not.toBeInTheDocument();
    expect(screen.queryByText('Authenticated Shell')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar de organización' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seguir con mi organización actual' }));

    expect(onAcceptPendingInvitation).toHaveBeenCalledTimes(1);
    expect(onDismissPendingInvitation).toHaveBeenCalledTimes(1);
  });

  it('renders the authenticated shell when membership exists', () => {
    renderGate({ authenticatedContent: <div>Authenticated Shell</div> });

    expect(screen.getByText('Authenticated Shell')).toBeInTheDocument();
  });

  it('renders the platform admin panel for allowlisted users without tenant membership', () => {
    renderGate({
      status: createStatus({
        hasMembership: false,
        isWaiting: false,
        platformAdmin: true,
      }),
    });

    expect(screen.getByText('Platform Admin Panel')).toBeInTheDocument();
  });

  it('routes paid members to the shell only when billing entitlement is active', () => {
    const { rerender } = renderGate({
      status: createStatus({
        hasMembership: true,
        billing: activeBilling({
          hasActiveEntitlement: false,
          source: null,
          status: null,
          productKind: null,
          classroomLimit: null,
        }),
      }),
      authenticatedContent: <div>Authenticated Shell</div>,
    });

    expect(screen.getByText('Onboarding View')).toBeInTheDocument();
    expect(screen.queryByText('Authenticated Shell')).not.toBeInTheDocument();

    rerender(
      <OnboardingAccessGate
        status={createStatus({
          hasMembership: true,
          billing: activeBilling(),
        })}
        isLoading={false}
        loadingTimedOut={false}
        isError={false}
        onRetry={() => undefined}
        onLogoutToLogin={() => undefined}
        onStatusChange={() => undefined}
        onCancelWaitingSuccess={() => undefined}
        onOrgCreated={() => undefined}
        authenticatedContent={<div>Authenticated Shell</div>}
      />
    );

    expect(screen.getByText('Authenticated Shell')).toBeInTheDocument();
  });
});
