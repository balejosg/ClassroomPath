import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomPathPricingPage } from '../Pricing';
import { getPricingQuote } from '../../data/pricing-data';

describe('ClassroomPathPricingPage', () => {
  it('renders the new pricing hero, CTA hierarchy, and pricing flow', () => {
    render(<ClassroomPathPricingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Calcula el primer año en segundos y decide el siguiente paso.',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Primer año = cuota anual por aula + onboarding único. Desde el segundo año, solo mantienes la cuota anual por aula. Si quieres empezar con poco alcance, usa la activación remota ligera y valida el encaje con tu equipo IT antes de ampliar.'
      )
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Calcular precio' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Solicitar activación' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Más habitual')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Qué paso te conviene ahora' })).toBeInTheDocument();
    expect(screen.getByText('149 €')).toBeInTheDocument();
    expect(screen.queryByText(/Aproximado por dispositivo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lightspeed|Securly|GoGuardian|Linewize/)).not.toBeInTheDocument();
  });

  it('renders the request form as budget, activation, or demo intake', () => {
    render(<ClassroomPathPricingPage onNavigateToLogin={vi.fn()} />);

    expect(screen.getByText('Solicitar presupuesto, activación o demo')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pide presupuesto, activación o revisión de despliegue' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    expect(screen.getByLabelText('Centro educativo')).toBeInTheDocument();
    expect(screen.getByLabelText('Email de contacto')).toBeInTheDocument();
    expect(screen.getByLabelText('Responsable técnico (opcional)')).toBeInTheDocument();
  });

  it('updates calculator totals when the classroom count changes', () => {
    render(<ClassroomPathPricingPage onNavigateToLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Número de aulas'), { target: { value: '40' } });

    const quote = getPricingQuote(40);

    expect(screen.getAllByText('Centro grande').length).toBeGreaterThan(0);
    expect(screen.getByText(/40 aulas x 37/)).toBeInTheDocument();
    expect(quote.annualTotal).toBe(1480);
    expect(quote.onboardingFee).toBe(890);
    expect(quote.totalFirstYear).toBe(2370);
    expect(screen.getByText('Estimación del primer año')).toBeInTheDocument();
    expect(screen.getByText('Total primer año')).toBeInTheDocument();
    expect(screen.queryByText(/Precio aproximado por dispositivo/i)).not.toBeInTheDocument();
  });

  it('navigates to login when the access CTA is clicked', () => {
    const onNavigateToLogin = vi.fn();

    render(<ClassroomPathPricingPage onNavigateToLogin={onNavigateToLogin} />);

    fireEvent.click(screen.getByRole('link', { name: 'Acceder' }));

    expect(onNavigateToLogin).toHaveBeenCalledTimes(1);
  });
});
