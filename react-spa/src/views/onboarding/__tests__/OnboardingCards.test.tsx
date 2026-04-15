import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../openpath/public-ui', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

import { OnboardingBillingCard, OnboardingInvitationCard } from '../OnboardingCards';

describe('OnboardingCards', () => {
  it('renders billing actions and forwards callbacks', () => {
    const onBillingInputChange = vi.fn();
    const onCheckout = vi.fn();
    const onManualRequest = vi.fn();

    render(
      <OnboardingBillingCard
        allowsOnlineCheckout
        billingInput={{ orgName: 'Centro', classrooms: '12' }}
        checkoutPending={false}
        manualRequestPending={false}
        onBillingInputChange={onBillingInputChange}
        onCheckout={onCheckout}
        onManualRequest={onManualRequest}
      />
    );

    fireEvent.change(screen.getByTestId('onboarding-org-name'), { target: { value: 'Otro' } });
    fireEvent.click(screen.getByText('Contratar cuota anual'));
    fireEvent.click(screen.getByText('Soy un centro público'));

    expect(onBillingInputChange).toHaveBeenCalledWith('orgName', 'Otro');
    expect(onCheckout).toHaveBeenCalledWith('annual');
    expect(onManualRequest).toHaveBeenCalledTimes(1);
  });

  it('renders the invitation flow and organization selector', () => {
    const onTargetOrgChange = vi.fn();
    const onWait = vi.fn();

    render(
      <OnboardingInvitationCard
        allowOrgDirectory
        onboardingPolicy={{
          allowSelfServiceOrgs: true,
          allowOrgDirectory: true,
          billingMode: 'stripe',
        }}
        organizations={[{ id: 'org-1', name: 'Org 1' }]}
        organizationsPending={false}
        organizationsError={false}
        targetOrgId=""
        waitPending={false}
        onTargetOrgChange={onTargetOrgChange}
        onWait={onWait}
      />
    );

    fireEvent.change(screen.getByTestId('onboarding-target-org'), { target: { value: 'org-1' } });
    fireEvent.click(screen.getByText('Solicitar Acceso'));

    expect(onTargetOrgChange).toHaveBeenCalledWith('org-1');
    expect(onWait).toHaveBeenCalledTimes(1);
  });
});
