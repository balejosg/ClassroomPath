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
      expect(getPricingTier(1).name).toBe('Small school');
      expect(getPricingTier(10).name).toBe('Small school');
      expect(getPricingTier(11).name).toBe('Medium school');
      expect(getPricingTier(25).name).toBe('Medium school');
      expect(getPricingTier(26).name).toBe('Large school');
      expect(getPricingTier(50).name).toBe('Large school');
      expect(getPricingTier(51).name).toBe('Educational organization');
      expect(getPricingTier(100).name).toBe('Educational organization');
      expect(getPricingTier(101).name).toBe('School network');
      expect(getPricingTier(9999).name).toBe('School network');
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
      expect(quote.tier.name).toBe('Medium school');
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
    it('formats an integer as euros without decimals', () => {
      // Locale formatting may use non-breaking spaces; strip them for comparison
      const result = formatCurrency(490).replace(/\s/g, ' ');
      expect(result).toContain('490');
      expect(result).toContain('€');
    });
  });

  describe('formatPricePerDevice', () => {
    it('formats sub-unit values with 2 decimal places', () => {
      const result = formatPricePerDevice(0.9).replace(/\s/g, ' ');
      expect(result).toContain('0,90');
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
