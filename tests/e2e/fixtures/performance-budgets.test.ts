import assert from 'node:assert/strict';
import test from 'node:test';

import { getBatchHealthcheckBudget, PERFORMANCE_BUDGETS } from './performance-budgets.js';

test('performance budgets stay internally consistent', () => {
  assert.ok(PERFORMANCE_BUDGETS.pageLoad.dashboardMs >= PERFORMANCE_BUDGETS.pageLoad.landingPageMs);
  assert.ok(PERFORMANCE_BUDGETS.userFlows.registrationMs >= PERFORMANCE_BUDGETS.userFlows.loginMs);
  assert.ok(
    PERFORMANCE_BUDGETS.network.slow3GDomContentLoadedMs >
      PERFORMANCE_BUDGETS.coreWebVitals.domContentLoadedMs
  );
});

test('batch healthcheck budget honors both slowdown allowance and hard cap', () => {
  assert.equal(
    getBatchHealthcheckBudget(100),
    100 * PERFORMANCE_BUDGETS.api.batchSlowdownFactor + PERFORMANCE_BUDGETS.api.batchSlackMs
  );
  assert.equal(getBatchHealthcheckBudget(5000), PERFORMANCE_BUDGETS.api.batchHardCapMs);
});
