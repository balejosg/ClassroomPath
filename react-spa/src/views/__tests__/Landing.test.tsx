import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomPathLandingPage } from '../Landing';

describe('ClassroomPathLandingPage', () => {
  it('renders the hero headline and key messaging', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', {
        name: 'La forma serena de gestionar Internet en el centro educativo.',
      })
    ).toBeInTheDocument();
    expect(screen.getByText('Transparencia basada en Software Libre')).toBeInTheDocument();
    expect(
      screen.getByText('Menos ruido digital. Más aprendizaje con criterio.')
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Ver precios' }).length).toBeGreaterThan(0);
  });

  it('renders the early access social proof section', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(screen.getByText('En fase early access')).toBeInTheDocument();
  });

  it('renders the contact form in the CTA section', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    expect(screen.getByLabelText('Centro educativo')).toBeInTheDocument();
    expect(screen.getByLabelText('Email de contacto')).toBeInTheDocument();
  });

  it('navigates to login when the access CTA is clicked', () => {
    const onNavigateToLogin = vi.fn();

    render(<ClassroomPathLandingPage onNavigateToLogin={onNavigateToLogin} />);

    fireEvent.click(screen.getByRole('link', { name: 'Acceder' }));

    expect(onNavigateToLogin).toHaveBeenCalledTimes(1);
  });
});
