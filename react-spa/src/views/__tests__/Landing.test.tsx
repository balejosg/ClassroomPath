import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomPathLandingPage } from '../Landing';

describe('ClassroomPathLandingPage', () => {
  it('renders the clearer hero messaging, trust strip, and primary navigation path', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Controla el acceso a Internet por aula sin sobrecargar al equipo TIC.',
      })
    ).toBeInTheDocument();
    expect(screen.getByText('Filtrado web escolar · Código abierto')).toBeInTheDocument();
    expect(
      screen.getByText('Control de Internet por aula · Servicio gestionado')
    ).toBeInTheDocument();
    expect(screen.getByText('30 dispositivos por aula, una sola cuota')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Calcular precio' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Probar con un piloto' })).toBeInTheDocument();
  });

  it('renders the fit and outcome sections for institutional buyers', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'ClassroomPath encaja si tu centro necesita...' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Qué cambia en las primeras semanas' })
    ).toBeInTheDocument();
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
