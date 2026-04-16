import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../openpath/public-shell', () => ({
  DomainRequests: ({ canDeleteRequests }: { canDeleteRequests?: boolean }) => (
    <div>DomainRequests delete={String(canDeleteRequests)}</div>
  ),
}));

vi.mock('../../pwa/PushNotificationControl', () => ({
  PushNotificationControl: () => <button type="button">Activar notificaciones</button>,
}));

import { DomainRequestsPage } from '../DomainRequestsPage';

describe('DomainRequestsPage', () => {
  it('renders notification opt-in above domain requests without delete access', () => {
    render(<DomainRequestsPage />);

    expect(screen.getByRole('button', { name: 'Activar notificaciones' })).toBeInTheDocument();
    expect(screen.getByText('DomainRequests delete=false')).toBeInTheDocument();
  });
});
