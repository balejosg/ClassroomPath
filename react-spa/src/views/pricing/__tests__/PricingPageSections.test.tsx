import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  PricingCalculatorSection,
  PricingContactSection,
  PricingPageHeader,
  parsePositiveInteger,
} from '../PricingPageSections';
import { getPricingQuote } from '../../../data/pricing-data';

describe('PricingPageSections', () => {
  it('parses positive classroom counts and rejects invalid values', () => {
    expect(parsePositiveInteger('12')).toBe(12);
    expect(parsePositiveInteger('0')).toBeNull();
    expect(parsePositiveInteger('abc')).toBeNull();
  });

  it('renders the header and contact CTA through extracted sections', () => {
    const onNavigateToLogin = vi.fn();

    render(
      <div>
        <PricingPageHeader onNavigateToLogin={onNavigateToLogin} />
        <PricingContactSection onNavigateToLogin={onNavigateToLogin} />
      </div>
    );

    fireEvent.click(screen.getAllByText('Acceder')[0] as HTMLElement);
    expect(onNavigateToLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Solicitar presupuesto, activación o demo')).toBeInTheDocument();
  });

  it('renders the calculator summary through the extracted section', () => {
    render(
      <PricingCalculatorSection
        classroomsInput="12"
        classroomsInputId="pricing-classrooms"
        quote={getPricingQuote(12)}
        onClassroomsInputChange={() => {}}
      />
    );

    expect(screen.getByText('Estimación del primer año')).toBeInTheDocument();
    expect(screen.getByLabelText('Número de aulas')).toBeInTheDocument();
  });
});
