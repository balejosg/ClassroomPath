import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomPathLandingPage } from '../Landing';

describe('ClassroomPathLandingPage', () => {
  it('renders the clearer hero messaging, trust strip, and primary navigation path', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Controla Internet por aula sin sobrecargar TIC.',
      })
    ).toBeInTheDocument();
    expect(screen.getByText('Transparencia basada en Software Libre')).toBeInTheDocument();
    expect(
      screen.getByText('Filtrado web escolar para dispositivos institucionales')
    ).toBeInTheDocument();
    expect(screen.getByText('Hasta 30 dispositivos institucionales por aula')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Calcular precio por aulas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Solicitar piloto guiado' })).toBeInTheDocument();
  });

  it('renders the fit and outcome sections for institutional buyers', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'Encaja mejor si tu centro necesita' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Qué cambia durante las primeras semanas' })
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
