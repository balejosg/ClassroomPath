import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomPathPricingPage } from '../Pricing';
import { getPricingQuote } from '../../data/pricing-data';

describe('ClassroomPathPricingPage', () => {
  it('renders the new pricing hero, CTA hierarchy, and pricing flow', () => {
    render(<ClassroomPathPricingPage onNavigateToLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Calculate the first year in seconds and decide the next step.',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'First year = annual classroom fee + one-time onboarding. From the second year, you keep only the annual classroom fee. If you want to start small, use lightweight remote activation and validate the fit with your IT team before expanding.'
      )
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Calculate price' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Request activation' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Most common')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What step suits you now' })).toBeInTheDocument();
    expect(screen.getByText('€149')).toBeInTheDocument();
    expect(screen.queryByText(/Aproximado por dispositivo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lightspeed|Securly|GoGuardian|Linewize/)).not.toBeInTheDocument();
  });

  it('renders the request form as budget, activation, or demo intake', () => {
    render(<ClassroomPathPricingPage onNavigateToLogin={vi.fn()} />);

    expect(screen.getByText('Request a quote, activation, or demo')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Ask for a quote, activation, or deployment review' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('School')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact email')).toBeInTheDocument();
    expect(screen.getByLabelText('Technical owner (optional)')).toBeInTheDocument();
  });

  it('updates calculator totals when the classroom count changes', () => {
    render(<ClassroomPathPricingPage onNavigateToLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Number of classrooms'), { target: { value: '40' } });

    const quote = getPricingQuote(40);

    expect(screen.getAllByText('Large school').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/40 classrooms x €37/).length).toBeGreaterThan(0);
    expect(quote.annualTotal).toBe(1480);
    expect(quote.onboardingFee).toBe(890);
    expect(quote.totalFirstYear).toBe(2370);
    expect(screen.getByText('First-year estimate')).toBeInTheDocument();
    expect(screen.getByText('Total first year')).toBeInTheDocument();
    expect(screen.queryByText(/Precio aproximado por dispositivo/i)).not.toBeInTheDocument();
  });

  it('navigates to login when the access CTA is clicked', () => {
    const onNavigateToLogin = vi.fn();

    render(<ClassroomPathPricingPage onNavigateToLogin={onNavigateToLogin} />);

    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));

    expect(onNavigateToLogin).toHaveBeenCalledTimes(1);
  });
});
