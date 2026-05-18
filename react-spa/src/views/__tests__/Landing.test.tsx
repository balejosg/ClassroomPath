import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomPathLandingPage } from '../Landing';

describe('ClassroomPathLandingPage', () => {
  it('renders the new landing hero, trust line, and CTA hierarchy', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Decide what Internet reaches each classroom, without adding more work for the IT team.',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Classroom web filtering by classroom · managed service on OpenPath')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Up to 30 devices per classroom · remote support for school IT · auditable open source'
      )
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Calculate price' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Request activation' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Request demo' })).not.toBeInTheDocument();
  });

  it('renders the new positioning, practical flow, and fit sections', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'We do not sell more screen time.' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it works in practice' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What each profile gains' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'ClassroomPath fits if your school needs...' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Ruta recomendada')).not.toBeInTheDocument();
    expect(screen.queryByText(/No añadimos otra capa de ruido/i)).not.toBeInTheDocument();
  });

  it('renders the broadened final request section', () => {
    render(<ClassroomPathLandingPage onNavigateToLogin={vi.fn()} />);

    expect(screen.getByText('Request a quote, activation, or demo')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Coordinate the next step with your IT team' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('School')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact email')).toBeInTheDocument();
    expect(screen.getByLabelText('Technical owner (optional)')).toBeInTheDocument();
  });

  it('navigates to login when the access CTA is clicked', () => {
    const onNavigateToLogin = vi.fn();

    render(<ClassroomPathLandingPage onNavigateToLogin={onNavigateToLogin} />);

    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));

    expect(onNavigateToLogin).toHaveBeenCalledTimes(1);
  });
});
