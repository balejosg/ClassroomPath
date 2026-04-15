import { describe, expect, it } from 'vitest';

import { fitSignals, practicalSteps, quickBenefits, roleBenefits } from '../LandingSectionData';

describe('LandingSectionData', () => {
  it('keeps the commercial section collections populated', () => {
    expect(quickBenefits).toHaveLength(3);
    expect(practicalSteps).toHaveLength(3);
    expect(roleBenefits).toHaveLength(3);
    expect(fitSignals).toHaveLength(4);
  });
});
