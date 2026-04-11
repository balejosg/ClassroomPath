import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { Onboarding } from '../Onboarding';

const mockCreateCheckout = vi.fn();
const mockCreateManualRequest = vi.fn();
const mockWaitForInvitation = vi.fn();

let organizations: Array<{ id: string; name: string }> = [];
let mockPolicy = {
  allowSelfServiceOrgs: true,
  allowOrgDirectory: true,
};

vi.mock('../../lib/hooks', () => ({
  useOnboardingStatus: () => ({
    data: {
      policy: mockPolicy,
    },
  }),
  useCreateBillingCheckout: () => ({
    mutate: mockCreateCheckout,
    isPending: false,
    error: null,
  }),
  useCreateManualBillingRequest: () => ({
    mutate: mockCreateManualRequest,
    isPending: false,
    error: null,
  }),
  useListOrganizations: () => ({
    data: organizations,
    isPending: false,
    isError: false,
    error: null,
  }),
  useWaitForInvitation: () => ({
    mutate: mockWaitForInvitation,
    isPending: false,
    error: null,
  }),
}));

describe('Onboarding policy UI', () => {
  const onOrgCreated = vi.fn();
  const onWaitClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    organizations = [{ id: 'org_1', name: 'Org 1' }];
    mockPolicy = {
      allowSelfServiceOrgs: true,
      allowOrgDirectory: true,
    };
  });

  it('hides self-service organization creation when policy disables it', () => {
    organizations = [];
    mockPolicy = {
      allowSelfServiceOrgs: false,
      allowOrgDirectory: false,
    };

    render(<Onboarding onOrgCreated={onOrgCreated} onWaitClick={onWaitClick} />);

    expect(screen.getByText('Contratar cuota anual')).toBeInTheDocument();
    expect(screen.getByText('Solicitar excepción')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-target-org')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-access-policy')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-wait-invite')).toBeInTheDocument();
  });

  it('does not enumerate organizations when directory discovery is disabled', () => {
    mockWaitForInvitation.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });
    organizations = [];
    mockPolicy = {
      allowSelfServiceOrgs: false,
      allowOrgDirectory: false,
    };

    render(<Onboarding onOrgCreated={onOrgCreated} onWaitClick={onWaitClick} />);

    expect(screen.queryByTestId('onboarding-target-org')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('onboarding-wait-invite'));

    expect(mockWaitForInvitation).toHaveBeenCalledWith(undefined, expect.anything());
    expect(onWaitClick).toHaveBeenCalled();
  });

  it('keeps both onboarding paths visible when the server policy enables them', () => {
    render(<Onboarding onOrgCreated={onOrgCreated} onWaitClick={onWaitClick} />);

    expect(screen.getByText('Contratar cuota anual')).toBeInTheDocument();
    expect(screen.getByText('Empezar piloto')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-target-org')).toBeInTheDocument();
    expect(screen.getByText('Org 1')).toBeInTheDocument();
  });

  it('auto-selects the only organization when directory access is enabled', () => {
    mockWaitForInvitation.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });
    organizations = [{ id: 'org_1', name: 'Org 1' }];
    mockPolicy = {
      allowSelfServiceOrgs: false,
      allowOrgDirectory: true,
    };

    render(<Onboarding onOrgCreated={onOrgCreated} onWaitClick={onWaitClick} />);

    expect(screen.getByTestId('onboarding-target-org')).toHaveValue('org_1');
    fireEvent.click(screen.getByTestId('onboarding-wait-invite'));

    expect(mockWaitForInvitation).toHaveBeenCalledWith(
      { targetOrganizationId: 'org_1' },
      expect.anything()
    );
  });
});
