import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Waiting } from '../Waiting';
import { setClassroomPathTestLocale } from '../../test/locale';

// Mock the hooks
const mockRefetch = vi.fn();
const mockCancelMutate = vi.fn();
const mockOnboardingStatus = vi.fn(() => ({
  data: null as {
    hasMembership: boolean;
    isWaiting: boolean;
    organization: null;
    platformAdmin: boolean;
    billing: null;
  } | null,
  refetch: mockRefetch,
  isFetching: false,
}));

vi.mock('../../lib/hooks', () => ({
  useOnboardingStatus: () => mockOnboardingStatus(),
  useCreateOrganization: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
  useWaitForInvitation: () => ({
    mutate: mockCancelMutate,
    isPending: false,
    error: null,
  }),
  useCancelWaiting: () => ({
    mutate: mockCancelMutate,
    isPending: false,
  }),
}));

describe('Waiting View', () => {
  const mockOnStatusChange = vi.fn();
  const mockOnCancelSuccess = vi.fn();

  beforeEach(() => {
    setClassroomPathTestLocale('es');
    vi.clearAllMocks();
    mockOnboardingStatus.mockReturnValue({
      data: null,
      refetch: mockRefetch,
      isFetching: false,
    });
  });

  it('should render waiting message', () => {
    render(<Waiting onStatusChange={mockOnStatusChange} onCancelSuccess={mockOnCancelSuccess} />);

    expect(screen.getByText('Esperando invitación')).toBeInTheDocument();
    expect(screen.getByTestId('waiting-room-illustration')).toHaveAttribute(
      'src',
      '/brand/classroompath-waiting-room.png'
    );
    expect(
      screen.getByText(/Un administrador de tu institución debe agregarte/)
    ).toBeInTheDocument();
    expect(screen.getByText('Verificar ahora')).toBeInTheDocument();
    expect(screen.getByText('Cambiar de opinión')).toBeInTheDocument();
  });

  it('should call refetch when "Verificar ahora" is clicked', () => {
    render(<Waiting onStatusChange={mockOnStatusChange} onCancelSuccess={mockOnCancelSuccess} />);

    fireEvent.click(screen.getByText('Verificar ahora'));

    expect(mockRefetch).toHaveBeenCalled();
  });

  it('should call cancel mutation when "Cambiar de opinión" is clicked', () => {
    render(<Waiting onStatusChange={mockOnStatusChange} onCancelSuccess={mockOnCancelSuccess} />);

    fireEvent.click(screen.getByText('Cambiar de opinión'));

    expect(mockCancelMutate).toHaveBeenCalled();
  });

  it('should call onStatusChange if data says hasMembership', () => {
    mockOnboardingStatus.mockReturnValue({
      data: {
        hasMembership: true,
        isWaiting: false,
        organization: null,
        platformAdmin: false,
        billing: null,
      },
      refetch: mockRefetch,
      isFetching: false,
    });

    render(<Waiting onStatusChange={mockOnStatusChange} onCancelSuccess={mockOnCancelSuccess} />);

    expect(mockOnStatusChange).toHaveBeenCalled();
  });
});
