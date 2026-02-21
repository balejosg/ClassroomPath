import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Onboarding } from '../Onboarding';

// Mock the hooks
const mockCreateOrg = vi.fn();
const mockWaitForInv = vi.fn();

vi.mock('../../lib/hooks', () => ({
  useCreateOrganization: () => ({
    mutate: mockCreateOrg,
    isPending: false,
    error: null,
  }),
  useListOrganizations: () => ({
    data: [{ id: 'org_1', name: 'Org 1' }],
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
