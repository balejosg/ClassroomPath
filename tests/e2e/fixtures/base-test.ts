import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

import { NavigationDebugger } from './navigation-debug';

type Fixtures = {
  navdbg: NavigationDebugger;
};

export const test = base.extend<Fixtures>({
  navdbg: async ({ page, context }, use) => {
    const enabled = process.env.E2E_NAV_DEBUG === '1' || process.env.E2E_NAV_DEBUG === 'true';
    const dbg = new NavigationDebugger(page, context, { maxEntries: 250, enabled });
    await dbg.install();
    await use(dbg);
  },
});

test.afterEach(async ({ navdbg }, testInfo) => {
  await navdbg.attachOnFailure(testInfo);
});

export { expect };
export type { Page, BrowserContext };
