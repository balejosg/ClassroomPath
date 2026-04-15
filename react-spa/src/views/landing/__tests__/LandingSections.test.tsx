import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LandingHeroSection, LandingRequestSection } from '../LandingSections';

describe('LandingSections', () => {
  it('renders the hero CTAs and trust line', () => {
    render(<LandingHeroSection onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Decide qué Internet entra en cada aula, sin cargar más al equipo TIC.',
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/Hasta 30 dispositivos por aula/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Calcular precio' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Solicitar activación' })).toBeInTheDocument();
  });

  it('routes the footer access CTA through the login callback', () => {
    const onNavigateToLogin = vi.fn();
    render(<LandingRequestSection onNavigateToLogin={onNavigateToLogin} />);

    fireEvent.click(screen.getByRole('link', { name: 'Acceder al panel' }));

    expect(onNavigateToLogin).toHaveBeenCalledTimes(1);
  });
});
