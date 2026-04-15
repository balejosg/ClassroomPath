import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OnboardingFeatureStrip } from '../OnboardingFeatureStrip';

describe('OnboardingFeatureStrip', () => {
  it('renders the onboarding trust strip', () => {
    render(<OnboardingFeatureStrip />);

    expect(screen.getByText('Open source en la base')).toBeInTheDocument();
    expect(screen.getByText('Flujos trazables')).toBeInTheDocument();
    expect(screen.getByText('Produccion oficial en la UE')).toBeInTheDocument();
  });
});
