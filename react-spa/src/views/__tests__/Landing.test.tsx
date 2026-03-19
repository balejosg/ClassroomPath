import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomPathLandingPage } from '../Landing';

describe('ClassroomPathLandingPage', () => {
  it('renders the updated trust messaging and managed service copy', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(screen.getByText('Transparencia basada en Software Libre')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Basado en OpenPath, ClassroomPath resuelve el mantenimiento e infraestructura para equipos educativos que necesitan fiabilidad, no complejidad.'
      )
    ).toBeInTheDocument();
  });

  it('navigates to login when the access CTA is clicked', () => {
    const onNavigateToLogin = vi.fn();

    render(<ClassroomPathLandingPage onNavigateToLogin={onNavigateToLogin} />);

    fireEvent.click(screen.getByRole('button', { name: 'Acceder' }));

    expect(onNavigateToLogin).toHaveBeenCalledTimes(1);
  });
});
