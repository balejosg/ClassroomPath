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

function createStatus(overrides: Partial<OnboardingStatusDto> = {}): OnboardingStatusDto {
  return {
    hasMembership: true,
    isWaiting: false,
    organization: null,
    platformAdmin: false,
    billing: {
      hasActiveEntitlement: true,
      source: 'stripe_subscription',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 12,
      expiresAt: null,
    },
    policy: {
      allowOrgDirectory: false,
      allowSelfServiceOrgs: false,
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
    onRetry: () => undefined,
    onLogoutToLogin: () => undefined,
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
        status={createStatus({ hasMembership: true })}
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
        billing: {
          hasActiveEntitlement: false,
          source: null,
          status: null,
          productKind: null,
          classroomLimit: null,
          expiresAt: null,
        },
      }),
      authenticatedContent: <div>Authenticated Shell</div>,
    });

    expect(screen.getByText('Onboarding View')).toBeInTheDocument();
    expect(screen.queryByText('Authenticated Shell')).not.toBeInTheDocument();

    rerender(
      <OnboardingAccessGate
        status={createStatus({
          hasMembership: true,
          billing: {
            hasActiveEntitlement: true,
            source: 'stripe_subscription',
            status: 'active',
            productKind: 'annual',
            classroomLimit: 12,
            expiresAt: null,
          },
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
