import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AdminPanel } from '../AdminPanel';

let pendingUsersState: any;

vi.mock('../../lib/hooks', () => ({
  usePendingUsers: vi.fn(() => pendingUsersState),
}));

vi.mock('../../views/PendingUsers', () => ({
  PendingUsers: () => <div>Pending Users Panel</div>,
}));

describe('AdminPanel', () => {
  beforeEach(() => {
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

    expect(screen.getByText('2 users waiting for approval')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByText('Access Requests')).toBeInTheDocument();
    expect(screen.getByText('Pending Users Panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(screen.queryByText('Pending Users Panel')).not.toBeInTheDocument();
  });
});
