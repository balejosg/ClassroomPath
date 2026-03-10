import { describe, expect, it } from 'vitest';

import { CURRENT_TERMS_VERSION } from '../legal';

describe('legal constants', () => {
  it('exports the current terms version as an ISO date string', () => {
    expect(CURRENT_TERMS_VERSION).toBe('2026-03-09');
    expect(CURRENT_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
