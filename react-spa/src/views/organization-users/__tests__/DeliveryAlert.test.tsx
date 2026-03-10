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

  it('renders warning notices with a manual url field', () => {
    render(
      <DeliveryAlert
        notice={{
          tone: 'warning',
          title: 'Invitación creada sin correo',
          description: 'Comparte este enlace manual.',
          url: 'https://classroompath.local/invite?token=abc123',
        }}
        onDismiss={() => {}}
      />
    );

    expect(screen.getByLabelText('Enlace manual')).toHaveValue(
      'https://classroompath.local/invite?token=abc123'
    );
  });
});
