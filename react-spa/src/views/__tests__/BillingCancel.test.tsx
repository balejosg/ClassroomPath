import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { BillingCancel } from '../BillingCancel';
import { setClassroomPathTestLocale } from '../../test/locale';

describe('BillingCancel', () => {
  beforeEach(() => {
    setClassroomPathTestLocale('es');
  });

  it('routes the user back or out after a canceled checkout', () => {
    const onBack = vi.fn();
    const onLogout = vi.fn();

    render(<BillingCancel onBack={onBack} onLogout={onLogout} />);

    expect(screen.getByText('Checkout cancelado')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Volver al onboarding' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
