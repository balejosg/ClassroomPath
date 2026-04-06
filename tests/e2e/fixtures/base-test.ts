import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

import { createSessionActorCatalog, type SessionActorCatalog } from './actors';
import { createMailboxFixture, type MailboxFixture } from './mailbox-provider';
import { NavigationDebugger } from './navigation-debug';
import { createE2EScenarioBuilder, type E2EScenarioBuilder } from './scenario-builder';

type Fixtures = {
  actors: SessionActorCatalog;
  navdbg: NavigationDebugger;
  mailbox: MailboxFixture;
  scenarios: E2EScenarioBuilder;
};

export const test = base.extend<Fixtures>({
  actors: async ({}, use) => {
    await use(createSessionActorCatalog());
  },
  navdbg: async ({ page, context }, use) => {
    const enabled = process.env.E2E_NAV_DEBUG === '1' || process.env.E2E_NAV_DEBUG === 'true';
    const dbg = new NavigationDebugger(page, context, { maxEntries: 250, enabled });
    await dbg.install();
    await use(dbg);
  },
  mailbox: async ({}, use) => {
    const fixture = await createMailboxFixture();
    try {
      await use(fixture.mailbox);
    } finally {
      await fixture.cleanup();
    }
  },
  scenarios: async ({ actors }, use) => {
    await use(createE2EScenarioBuilder(actors));
  },
});

test.afterEach(async ({ navdbg }, testInfo) => {
  await navdbg.attachOnFailure(testInfo);
});

export { expect };
export type { Page, BrowserContext };
