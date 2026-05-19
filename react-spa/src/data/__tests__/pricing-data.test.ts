import { describe, expect, it } from 'vitest';
import {
  PRICING_TIERS,
  ONBOARDING_TIERS,
  PILOT,
  getPricingTier,
  getOnboardingTier,
  getPricingQuote,
  formatCurrency,
  formatPricePerDevice,
} from '../pricing-data';

describe('pricing-data', () => {
  describe('getPricingTier', () => {
    it('returns the correct tier for each range', () => {
      expect(getPricingTier(1).nameKey).toBe('pricing.tier.small.name');
      expect(getPricingTier(10).nameKey).toBe('pricing.tier.small.name');
      expect(getPricingTier(11).nameKey).toBe('pricing.tier.medium.name');
      expect(getPricingTier(25).nameKey).toBe('pricing.tier.medium.name');
      expect(getPricingTier(26).nameKey).toBe('pricing.tier.large.name');
      expect(getPricingTier(50).nameKey).toBe('pricing.tier.large.name');
      expect(getPricingTier(51).nameKey).toBe('pricing.tier.organization.name');
      expect(getPricingTier(100).nameKey).toBe('pricing.tier.organization.name');
      expect(getPricingTier(101).nameKey).toBe('pricing.tier.network.name');
      expect(getPricingTier(9999).nameKey).toBe('pricing.tier.network.name');
    });
  });

  describe('getOnboardingTier', () => {
    it('returns the correct onboarding tier', () => {
      expect(getOnboardingTier(1).oneTimeFee).toBe(490);
      expect(getOnboardingTier(25).oneTimeFee).toBe(490);
      expect(getOnboardingTier(26).oneTimeFee).toBe(890);
      expect(getOnboardingTier(100).oneTimeFee).toBe(890);
      expect(getOnboardingTier(101).oneTimeFee).toBeNull();
    });
  });

  describe('getPricingQuote', () => {
    it('computes the correct annual total and first-year total', () => {
      const quote = getPricingQuote(12);
      expect(quote.tier.nameKey).toBe('pricing.tier.medium.name');
      expect(quote.annualTotal).toBe(12 * 45);
      expect(quote.onboardingFee).toBe(490);
      expect(quote.totalFirstYear).toBe(12 * 45 + 490);
    });

    it('returns null for totalFirstYear when onboarding is TBD (101+ aulas)', () => {
      const quote = getPricingQuote(150);
      expect(quote.onboardingFee).toBeNull();
      expect(quote.totalFirstYear).toBeNull();
    });
  });

  describe('formatCurrency', () => {
    it('formats euros with the active locale', () => {
      expect(formatCurrency(490, 'es').replace(/\s/g, ' ')).toContain('490 €');
      expect(formatCurrency(490, 'en').replace(/\s/g, ' ')).toContain('€490');
    });
  });

  describe('formatPricePerDevice', () => {
    it('formats sub-unit values with the active locale', () => {
      expect(formatPricePerDevice(0.9, 'es').replace(/\s/g, ' ')).toContain('0,90');
      expect(formatPricePerDevice(0.9, 'en').replace(/\s/g, ' ')).toContain('0.90');
    });
  });

  it('exports PILOT with correct values', () => {
    expect(PILOT.classrooms).toBe(5);
    expect(PILOT.durationDays).toBe(90);
    expect(PILOT.totalPrice).toBe(290);
  });

  it('exports all 5 pricing tiers', () => {
    expect(PRICING_TIERS).toHaveLength(5);
  });

  it('exports all 3 onboarding tiers', () => {
    expect(ONBOARDING_TIERS).toHaveLength(3);
  });
});
