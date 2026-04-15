import React from 'react';

import { SharedFooter } from '../components/SharedFooter';
import { PRICING_TIERS, getPricingQuote } from '../data/pricing-data';
import {
  PricingCalculatorSection,
  PricingContactSection,
  PricingFaqSection,
  PricingHero,
  PricingIncludedSection,
  PricingModelSection,
  PricingNextStepsSection,
  PricingNotIncludedSection,
  PricingOnboardingSection,
  PricingPageHeader,
  PricingTiersSection,
  parsePositiveInteger,
} from './pricing/PricingPageSections';

export { getPricingQuote } from '../data/pricing-data';

interface ClassroomPathPricingPageProps {
  onNavigateToLogin: () => void;
}

export function ClassroomPathPricingPage({ onNavigateToLogin }: ClassroomPathPricingPageProps) {
  const [classroomsInput, setClassroomsInput] = React.useState('12');
  const classroomsInputId = React.useId();
  const parsedClassrooms = parsePositiveInteger(classroomsInput);
  const quote = getPricingQuote(parsedClassrooms ?? 12);
  const recommendedTier = PRICING_TIERS.find((tier) => tier.recommended) ?? PRICING_TIERS[1];

  return (
    <div className="min-h-screen scroll-smooth bg-slate-50 text-slate-900">
      <PricingPageHeader onNavigateToLogin={onNavigateToLogin} />

      <main>
        <PricingHero recommendedTier={recommendedTier} />
        <PricingNextStepsSection />
        <PricingIncludedSection />
        <PricingTiersSection />
        <PricingOnboardingSection />
        <PricingCalculatorSection
          classroomsInput={classroomsInput}
          classroomsInputId={classroomsInputId}
          quote={quote}
          onClassroomsInputChange={setClassroomsInput}
        />
        <PricingModelSection />
        <PricingNotIncludedSection />
        <PricingFaqSection />
        <PricingContactSection onNavigateToLogin={onNavigateToLogin} />
      </main>
      <SharedFooter />
    </div>
  );
}
