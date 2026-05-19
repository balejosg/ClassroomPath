import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OnboardingFeatureStrip } from '../OnboardingFeatureStrip';
import { clearClassroomPathTestLocale, setClassroomPathTestLocale } from '../../../test/locale';

describe('OnboardingFeatureStrip', () => {
  afterEach(() => {
    clearClassroomPathTestLocale();
  });

  it('renders the onboarding trust strip in Spanish with corrected accents', () => {
    setClassroomPathTestLocale('es');
    render(<OnboardingFeatureStrip />);

    expect(screen.getByText('Open source en la base')).toBeInTheDocument();
    expect(screen.getByText('Flujos trazables')).toBeInTheDocument();
    expect(screen.getByText('Producción oficial en la UE')).toBeInTheDocument();
    expect(screen.getByText(/política digital/)).toBeInTheDocument();
    expect(screen.getByText(/está alojado/)).toBeInTheDocument();
  });

  it('renders the onboarding trust strip in English', () => {
    setClassroomPathTestLocale('en');
    render(<OnboardingFeatureStrip />);

    expect(screen.getByText('Open source foundation')).toBeInTheDocument();
    expect(screen.getByText('Traceable flows')).toBeInTheDocument();
    expect(screen.getByText('Official EU production')).toBeInTheDocument();
  });
});
