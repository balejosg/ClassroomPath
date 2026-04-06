export const PERFORMANCE_BUDGETS = {
  pageLoad: {
    landingPageMs: 3000,
    onboardingMs: 4000,
    dashboardMs: 5000,
    organizationMs: 4000,
  },
  userFlows: {
    registrationMs: 15000,
    loginMs: 8000,
  },
  coreWebVitals: {
    firstPaintMs: 1500,
    domContentLoadedMs: 3000,
    largestContentfulPaintMs: 2500,
    cumulativeLayoutShift: 0.1,
  },
  api: {
    endpointResponseMs: 2000,
    batchSlowdownFactor: 2.5,
    batchSlackMs: 100,
    batchHardCapMs: 2000,
  },
  memory: {
    heapGrowthBytes: 50 * 1024 * 1024,
  },
  bundle: {
    javascriptBytes: 1.5 * 1024 * 1024,
    cssBytes: 300 * 1024,
  },
  network: {
    slow3GDomContentLoadedMs: 60000,
  },
} as const;

export function getBatchHealthcheckBudget(singleRequestTotalMs: number): number {
  return Math.min(
    PERFORMANCE_BUDGETS.api.batchHardCapMs,
    singleRequestTotalMs * PERFORMANCE_BUDGETS.api.batchSlowdownFactor +
      PERFORMANCE_BUDGETS.api.batchSlackMs
  );
}
