import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { DeliveryAlert } from '../DeliveryAlert';

describe('DeliveryAlert', () => {
  it('renders success notices without the manual url field', () => {
    const onDismiss = vi.fn();

    render(
      <DeliveryAlert
        notice={{
          tone: 'success',
          title: 'Invitation sent',
          description: 'Invitation sent to ada@example.com.',
        }}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Invitation sent');
    expect(screen.queryByDisplayValue(/https?:\/\//)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders warning notices without any manual url field', () => {
    render(
      <DeliveryAlert
        notice={{
          tone: 'warning',
          title: 'Invitation delivery pending',
          description: 'Retry the invitation from this screen.',
        }}
        onDismiss={() => {}}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Invitation delivery pending');
    expect(screen.queryByLabelText('Manual link')).not.toBeInTheDocument();
  });
});
