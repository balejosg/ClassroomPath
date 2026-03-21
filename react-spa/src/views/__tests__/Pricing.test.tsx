import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomPathPricingPage } from '../Pricing';
import { getPricingQuote } from '../../data/pricing-data';

describe('ClassroomPathPricingPage', () => {
  it('renders the pricing headline and included classroom scope', () => {
    render(<ClassroomPathPricingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Precios simples por aula, para una política digital más clara',
      })
    ).toBeInTheDocument();
    expect(screen.getByText('Hasta 30 dispositivos por aula')).toBeInTheDocument();
    expect(screen.getAllByText('Servicio gestionado sobre OpenPath').length).toBeGreaterThan(0);
  });

  it('renders the contact form in the CTA section', () => {
    render(<ClassroomPathPricingPage onNavigateToLogin={vi.fn()} />);

    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    expect(screen.getByLabelText('Centro educativo')).toBeInTheDocument();
    expect(screen.getByLabelText('Email de contacto')).toBeInTheDocument();
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
    expect(quote.approxPricePerDevicePerYear).toBe(1.23);
  });

  it('navigates to login when the access CTA is clicked', () => {
    const onNavigateToLogin = vi.fn();

    render(<ClassroomPathPricingPage onNavigateToLogin={onNavigateToLogin} />);

    fireEvent.click(screen.getByRole('button', { name: 'Acceder' }));

    expect(onNavigateToLogin).toHaveBeenCalledTimes(1);
  });
});
