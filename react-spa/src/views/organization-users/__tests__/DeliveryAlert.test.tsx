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
          title: 'Invitación enviada',
          description: 'Se envió la invitación a ada@example.com.',
        }}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Invitación enviada');
    expect(screen.queryByDisplayValue(/https?:\/\//)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders warning notices without any manual url field', () => {
    render(
      <DeliveryAlert
        notice={{
          tone: 'warning',
          title: 'Invitación pendiente de envío',
          description: 'Reintenta la invitación desde esta pantalla.',
        }}
        onDismiss={() => {}}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Invitación pendiente de envío');
    expect(screen.queryByLabelText('Enlace manual')).not.toBeInTheDocument();
  });
});
