import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Onboarding } from '../Onboarding';

// Mock the hooks
const mockCreateOrg = vi.fn();
const mockWaitForInv = vi.fn();
let mockPolicy = { allowSelfServiceOrgs: true, allowOrgDirectory: true };
let mockOrganizations = [{ id: 'org_1', name: 'Org 1' }];

vi.mock('../../lib/hooks', () => ({
  useOnboardingStatus: () => ({
    data: {
      policy: mockPolicy,
    },
  }),
  useCreateOrganization: () => ({
    mutate: mockCreateOrg,
    isPending: false,
    error: null,
  }),
  useListOrganizations: () => ({
    data: mockOrganizations,
    isPending: false,
    isError: false,
    error: null,
  }),
  useWaitForInvitation: () => ({
    mutate: mockWaitForInv,
    isPending: false,
    error: null,
  }),
}));

describe('Onboarding View', () => {
  const mockOnOrgCreated = vi.fn();
  const mockOnWaitClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicy = { allowSelfServiceOrgs: true, allowOrgDirectory: true };
    mockOrganizations = [{ id: 'org_1', name: 'Org 1' }];
  });

  it('should render initial selection view', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    expect(screen.getByText(/¡Bienvenido a ClassroomPath!/i)).toBeInTheDocument();
    expect(screen.getByText('Crear mi organización')).toBeInTheDocument();
    expect(screen.getByText('Esperar invitación')).toBeInTheDocument();
  });

  it('should show organization name input', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    expect(screen.getByPlaceholderText('Ej: Colegio San José')).toBeInTheDocument();
    expect(screen.getByText('Crear Organización')).toBeInTheDocument();
  });

  it('should call create organization mutation with valid name', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.change(screen.getByPlaceholderText('Ej: Colegio San José'), {
      target: { value: 'Test Org' },
    });
    fireEvent.click(screen.getByText('Crear Organización'));

    expect(mockCreateOrg).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Test Org' }),
      expect.anything()
    );
  });

  it('should show error if organization name is empty', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.click(screen.getByText('Crear Organización'));

    expect(screen.getByText('Debes ingresar un nombre para la organización')).toBeInTheDocument();
    expect(mockCreateOrg).not.toHaveBeenCalled();
  });

  it('should call onWaitClick when Solicitar Acceso is clicked', async () => {
    // Modify hook to trigger onSuccess immediately for this test
    vi.mocked(mockWaitForInv).mockImplementation((_data, options) => {
      options?.onSuccess?.();
    });

    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    // Auto-select runs in an effect; wait for it before clicking.
    await waitFor(() => {
      const select = screen.getByTestId('onboarding-target-org') as HTMLSelectElement;
      expect(select.value).toBe('org_1');
    });

    fireEvent.click(screen.getByText('Solicitar Acceso'));

    expect(mockWaitForInv).toHaveBeenCalled();
    expect(mockOnWaitClick).toHaveBeenCalled();
  });
});

describe('Onboarding policy UI', () => {
  const mockOnOrgCreated = vi.fn();
  const mockOnWaitClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicy = { allowSelfServiceOrgs: true, allowOrgDirectory: true };
    mockOrganizations = [{ id: 'org_1', name: 'Org 1' }];
  });

  it('hides self-service organization creation when policy disables it', () => {
    mockPolicy = { allowSelfServiceOrgs: false, allowOrgDirectory: false };
    mockOrganizations = [];

    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    expect(screen.queryByTestId('onboarding-create-org')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-target-org')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-access-policy')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-wait-invite')).toBeInTheDocument();
  });

  it('does not enumerate organizations when directory discovery is disabled', () => {
    mockPolicy = { allowSelfServiceOrgs: false, allowOrgDirectory: false };
    mockOrganizations = [];
    vi.mocked(mockWaitForInv).mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });

    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.click(screen.getByTestId('onboarding-wait-invite'));

    expect(mockWaitForInv).toHaveBeenCalledWith(undefined, expect.anything());
    expect(mockOnWaitClick).toHaveBeenCalled();
  });

  it('keeps both onboarding paths visible when the server policy enables them', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    expect(screen.getByText('Crear mi organización')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-target-org')).toBeInTheDocument();
    expect(screen.getByText('Org 1')).toBeInTheDocument();
  });
});
