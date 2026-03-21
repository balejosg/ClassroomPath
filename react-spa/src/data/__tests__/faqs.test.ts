import { describe, expect, it } from 'vitest';
import { LANDING_FAQS, PRICING_FAQS } from '../faqs';

describe('faqs', () => {
  it('exports non-empty LANDING_FAQS', () => {
    expect(LANDING_FAQS.length).toBeGreaterThan(0);
    for (const faq of LANDING_FAQS) {
      expect(typeof faq.q).toBe('string');
      expect(faq.q.length).toBeGreaterThan(0);
      expect(typeof faq.a).toBe('string');
      expect(faq.a.length).toBeGreaterThan(0);
    }
  });

  it('exports non-empty PRICING_FAQS', () => {
    expect(PRICING_FAQS.length).toBeGreaterThan(0);
    for (const faq of PRICING_FAQS) {
      expect(typeof faq.q).toBe('string');
      expect(faq.q.length).toBeGreaterThan(0);
      expect(typeof faq.a).toBe('string');
      expect(faq.a.length).toBeGreaterThan(0);
    }
  });

  it('has no overlapping questions between Landing and Pricing FAQs', () => {
    const landingQuestions = new Set(LANDING_FAQS.map((f) => f.q));
    const overlap = PRICING_FAQS.filter((f) => landingQuestions.has(f.q));
    expect(overlap).toHaveLength(0);
  });
});
