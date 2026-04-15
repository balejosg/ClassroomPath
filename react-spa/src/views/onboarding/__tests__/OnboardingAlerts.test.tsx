import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OnboardingAlert } from '../OnboardingAlerts';

describe('OnboardingAlert', () => {
  it('renders success and error notices with the shared alert component', () => {
    const { rerender } = render(<OnboardingAlert tone="error" message="Algo falló" />);
    expect(screen.getByText('Algo falló')).toBeInTheDocument();

    rerender(<OnboardingAlert tone="success" message="Todo bien" />);
    expect(screen.getByText('Todo bien')).toBeInTheDocument();
  });
});
