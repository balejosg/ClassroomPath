import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Onboarding } from '../Onboarding';

const mockCreateOrg = vi.fn();
const mockCreateCheckout = vi.fn();
const mockCreateManualRequest = vi.fn();
const mockWaitForInv = vi.fn();
const mockLogout = vi.fn();

let mockPolicy = {
  allowSelfServiceOrgs: true,
  allowOrgDirectory: true,
  billingMode: 'stripe',
};
let mockOrganizations = [{ id: 'org_1', name: 'Org 1' }];
let mockOrganizationsPending = false;
let mockOrganizationsError = false;
let mockCheckoutPending = false;
let mockManualRequestPending = false;
let mockWaitPending = false;

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
  useCreateBillingCheckout: () => ({
    mutate: mockCreateCheckout,
    isPending: mockCheckoutPending,
    error: null,
  }),
  useCreateManualBillingRequest: () => ({
    mutate: mockCreateManualRequest,
    isPending: mockManualRequestPending,
    error: null,
  }),
  useListOrganizations: () => ({
    data: mockOrganizations,
    isPending: mockOrganizationsPending,
    isError: mockOrganizationsError,
    error: null,
  }),
  useWaitForInvitation: () => ({
    mutate: mockWaitForInv,
    isPending: mockWaitPending,
    error: null,
  }),
}));

describe('Onboarding View', () => {
  const mockOnOrgCreated = vi.fn();
  const mockOnWaitClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicy = {
      allowSelfServiceOrgs: true,
      allowOrgDirectory: true,
      billingMode: 'stripe',
    };
    mockOrganizations = [{ id: 'org_1', name: 'Org 1' }];
    mockOrganizationsPending = false;
    mockOrganizationsError = false;
    mockCheckoutPending = false;
    mockManualRequestPending = false;
    mockWaitPending = false;
  });

  it('should render checkout-gated onboarding choices', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    expect(screen.getByText(/¡Bienvenido a ClassroomPath!/i)).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-governance-illustration')).toHaveAttribute(
      'src',
      '/brand/classroompath-onboarding-governance.png'
    );
    expect(screen.getByText('Contratar cuota anual')).toBeInTheDocument();
    expect(screen.getByText('Empezar piloto')).toBeInTheDocument();
    expect(screen.getByText('Soy un centro público')).toBeInTheDocument();
    expect(screen.getByText('Esperar invitación')).toBeInTheDocument();
  });

  it('should show organization name and classroom count inputs', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    expect(screen.getByPlaceholderText('Ej: Colegio San José')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-classrooms')).toBeInTheDocument();
  });

  it('should start annual checkout with valid organization data', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.change(screen.getByPlaceholderText('Ej: Colegio San José'), {
      target: { value: 'Test Org' },
    });
    fireEvent.change(screen.getByTestId('onboarding-classrooms'), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByText('Contratar cuota anual'));

    expect(mockCreateCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'annual',
        organizationName: 'Test Org',
        classrooms: 12,
      }),
      expect.anything()
    );
  });

  it('starts pilot checkout with valid organization data', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.change(screen.getByPlaceholderText('Ej: Colegio San José'), {
      target: { value: 'Pilot Org' },
    });
    fireEvent.change(screen.getByTestId('onboarding-classrooms'), {
      target: { value: '24' },
    });
    fireEvent.click(screen.getByText('Empezar piloto'));

    expect(mockCreateCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'pilot',
        organizationName: 'Pilot Org',
        classrooms: 24,
      }),
      expect.anything()
    );
  });

  it('should show error if organization name is empty', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.click(screen.getByText('Contratar cuota anual'));

    expect(screen.getByText('Debes ingresar un nombre para la organización')).toBeInTheDocument();
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it('validates the classroom count before starting checkout', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.change(screen.getByPlaceholderText('Ej: Colegio San José'), {
      target: { value: 'Invalid Classrooms Org' },
    });
    fireEvent.change(screen.getByTestId('onboarding-classrooms'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByText('Contratar cuota anual'));

    expect(screen.getByText('Debes indicar al menos un aula')).toBeInTheDocument();
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it('should submit public campaign manual requests without redirecting to Stripe', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.change(screen.getByPlaceholderText('Ej: Colegio San José'), {
      target: { value: 'Public School' },
    });
    fireEvent.click(screen.getByText('Soy un centro público'));

    expect(mockCreateManualRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'public_campaign',
        organizationName: 'Public School',
        classrooms: 12,
      }),
      expect.anything()
    );
  });

  it('shows the manual-request success notice when the mutation succeeds', async () => {
    mockCreateManualRequest.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });

    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.change(screen.getByPlaceholderText('Ej: Colegio San José'), {
      target: { value: 'Centro publico' },
    });
    fireEvent.click(screen.getByText('Soy un centro público'));

    expect(
      await screen.findByText(
        'Solicitud enviada. Revisaremos la activación antes de habilitar el centro.'
      )
    ).toBeInTheDocument();
  });

  it('should call onWaitClick when Solicitar Acceso is clicked', async () => {
    vi.mocked(mockWaitForInv).mockImplementation((_data, options) => {
      options?.onSuccess?.();
    });

    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    await waitFor(() => {
      const select = screen.getByTestId('onboarding-target-org') as HTMLSelectElement;
      expect(select.value).toBe('org_1');
    });

    fireEvent.click(screen.getByText('Solicitar Acceso'));

    expect(mockWaitForInv).toHaveBeenCalled();
    expect(mockOnWaitClick).toHaveBeenCalled();
  });

  it('requires selecting an organization when directory access is enabled', () => {
    mockOrganizations = [
      { id: 'org_1', name: 'Org 1' },
      { id: 'org_2', name: 'Org 2' },
    ];

    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.click(screen.getByTestId('onboarding-wait-invite'));

    expect(
      screen.getByText('Selecciona una organización para solicitar acceso')
    ).toBeInTheDocument();
    expect(mockWaitForInv).not.toHaveBeenCalled();
  });

  it('shows wait errors, supports manual organization selection, and renders logout when provided', async () => {
    mockOrganizations = [
      { id: 'org_1', name: 'Org 1' },
      { id: 'org_2', name: 'Org 2' },
    ];
    mockOrganizationsError = true;
    mockWaitForInv.mockImplementation((_input, options) => {
      options?.onError?.(new Error('Error de invitación'));
    });

    render(
      <Onboarding
        onOrgCreated={mockOnOrgCreated}
        onWaitClick={mockOnWaitClick}
        onLogout={mockLogout}
      />
    );

    fireEvent.change(screen.getByTestId('onboarding-target-org'), {
      target: { value: 'org_2' },
    });
    fireEvent.click(screen.getByTestId('onboarding-wait-invite'));

    expect(mockWaitForInv).toHaveBeenCalledWith(
      { targetOrganizationId: 'org_2' },
      expect.anything()
    );
    expect(await screen.findByText('Error de invitación')).toBeInTheDocument();
    expect(screen.getByText('No se pudieron cargar organizaciones.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});

describe('Onboarding policy UI', () => {
  const mockOnOrgCreated = vi.fn();
  const mockOnWaitClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicy = {
      allowSelfServiceOrgs: true,
      allowOrgDirectory: true,
      billingMode: 'stripe',
    };
    mockOrganizations = [{ id: 'org_1', name: 'Org 1' }];
    mockOrganizationsPending = false;
    mockOrganizationsError = false;
  });

  it('hides self-service organization creation when policy disables it', () => {
    mockPolicy = {
      allowSelfServiceOrgs: false,
      allowOrgDirectory: false,
      billingMode: 'manual_only',
    };
    mockOrganizations = [];

    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    expect(screen.queryByText('Crear mi organización')).not.toBeInTheDocument();
    expect(screen.queryByText('Contratar cuota anual')).not.toBeInTheDocument();
    expect(screen.getByText('Soy un centro público')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-target-org')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-access-policy')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-wait-invite')).toBeInTheDocument();
  });

  it('does not enumerate organizations when directory discovery is disabled', () => {
    mockPolicy = {
      allowSelfServiceOrgs: false,
      allowOrgDirectory: false,
      billingMode: 'manual_only',
    };
    mockOrganizations = [];
    vi.mocked(mockWaitForInv).mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });

    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    fireEvent.click(screen.getByTestId('onboarding-wait-invite'));

    expect(mockWaitForInv).toHaveBeenCalledWith(undefined, expect.anything());
    expect(mockOnWaitClick).toHaveBeenCalled();
  });

  it('keeps checkout and invitation paths visible when the server policy enables them', () => {
    render(<Onboarding onOrgCreated={mockOnOrgCreated} onWaitClick={mockOnWaitClick} />);

    expect(screen.getByText('Contratar cuota anual')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-target-org')).toBeInTheDocument();
    expect(screen.getByText('Org 1')).toBeInTheDocument();
  });
});
