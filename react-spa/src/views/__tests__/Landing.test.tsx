import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomPathLandingPage } from '../Landing';

describe('ClassroomPathLandingPage', () => {
  it('renders the trust messaging and pricing entry point', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(screen.getByText('Transparencia basada en Software Libre')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Basado en OpenPath, ClassroomPath resuelve el mantenimiento y la infraestructura para equipos educativos que necesitan fiabilidad, no complejidad.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Cuando haya pantalla, que haya propósito.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Ver precios' }).length).toBeGreaterThan(0);
  });

  it('navigates to login when the access CTA is clicked', () => {
    const onNavigateToLogin = vi.fn();

    render(<ClassroomPathLandingPage onNavigateToLogin={onNavigateToLogin} />);

    fireEvent.click(screen.getByRole('button', { name: 'Acceder' }));

    expect(onNavigateToLogin).toHaveBeenCalledTimes(1);
  });
});
