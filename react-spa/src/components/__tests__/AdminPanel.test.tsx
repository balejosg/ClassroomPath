import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AdminPanel } from '../AdminPanel';
import { setClassroomPathTestLocale } from '../../test/locale';

let pendingUsersState: any;

vi.mock('../../lib/hooks', () => ({
  usePendingUsers: vi.fn(() => pendingUsersState),
}));

vi.mock('../../views/PendingUsers', () => ({
  PendingUsers: () => <div>Pending Users Panel</div>,
}));

describe('AdminPanel', () => {
  beforeEach(() => {
    setClassroomPathTestLocale('es');
    pendingUsersState = {
      data: [],
      isLoading: false,
    };
  });

  it('does not render for non-admin users', () => {
    const { container } = render(<AdminPanel userRole="teacher" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the notification bar and opens the pending users panel for admins', () => {
    pendingUsersState = {
      data: [{ id: 'pending-1' }, { id: 'pending-2' }],
      isLoading: false,
    };

    render(<AdminPanel userRole="admin" />);

    expect(screen.getByText('2 usuarios esperando aprobación')).toBeInTheDocument();
    const banner = screen.getByTestId('admin-pending-users-banner');
    expect(banner).toHaveClass('top-16');
    expect(banner).not.toHaveClass('top-0');

    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));

    const dialog = screen.getByRole('dialog', { name: 'Solicitudes de acceso' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass('fixed');
    expect(dialog).toHaveClass('right-0');
    expect(dialog).toHaveClass('top-16');
    expect(screen.getByText('Pending Users Panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
    expect(screen.queryByText('Pending Users Panel')).not.toBeInTheDocument();
  });

  it('closes the pending users panel with Escape', () => {
    pendingUsersState = {
      data: [{ id: 'pending-1' }],
      isLoading: false,
    };

    render(<AdminPanel userRole="admin" />);

    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    expect(screen.getByRole('dialog', { name: 'Solicitudes de acceso' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Solicitudes de acceso' })).not.toBeInTheDocument();
  });
});
