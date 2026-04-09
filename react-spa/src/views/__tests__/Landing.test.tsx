import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomPathLandingPage } from '../Landing';

describe('ClassroomPathLandingPage', () => {
  it('renders the new landing hero, trust line, and CTA hierarchy', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Decide qué Internet entra en cada aula, sin cargar más al equipo TIC.',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Filtrado web escolar por aula · servicio gestionado sobre OpenPath')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Hasta 30 dispositivos por aula · onboarding guiado · código abierto auditable'
      )
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Calcular precio' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Empezar piloto' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Solicitar demo' })).not.toBeInTheDocument();
  });

  it('renders the new positioning, practical flow, and fit sections', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'No vendemos más tiempo de pantalla.' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Cómo funciona en la práctica' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Qué gana cada perfil' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'ClassroomPath encaja si tu centro necesita...' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Ruta recomendada')).not.toBeInTheDocument();
    expect(screen.queryByText(/No añadimos otra capa de ruido/i)).not.toBeInTheDocument();
  });

  it('renders the broadened final request section', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(screen.getByText('Solicitar presupuesto, piloto o demo')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Revisa si encaja en tu centro antes de desplegar' })
    ).toBeInTheDocument();
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
