import type { Browser, BrowserContext, Page } from '@playwright/test';

import type { TestUser } from './accounts';
import {
  getAdminAccountForWorker,
  getOnboardingAccountForWorker,
  getPendingAccountForWorker,
  getTeacherAccountForWorker,
} from './accounts';

export type SessionActorKind = 'admin' | 'teacher' | 'onboarding' | 'pending';

export interface SessionActor extends TestUser {
  kind: SessionActorKind;
  userId: string;
  workerSlot?: number;
  variantOffset?: number;
  status?: 'waiting';
  orgName?: string;
}

export interface ActorSessionContext {
  actor: SessionActor;
  userContext: BrowserContext;
  userPage: Page;
}

export interface SessionActorCatalog {
  admin(): SessionActor;
  teacher(): SessionActor;
  onboarding(variantOffset?: number): SessionActor;
  pending(variantOffset?: number): SessionActor;
}

function toSessionActor(
  kind: SessionActorKind,
  actor: ReturnType<typeof getAdminAccountForWorker>
): SessionActor {
  return {
    ...actor,
    kind,
    userId: actor.id,
  };
}

export function createSessionActorCatalog(): SessionActorCatalog {
  return {
    admin: () => toSessionActor('admin', getAdminAccountForWorker()),
    teacher: () => toSessionActor('teacher', getTeacherAccountForWorker()),
    onboarding: (variantOffset = 0) =>
      toSessionActor('onboarding', getOnboardingAccountForWorker(variantOffset)),
    pending: (variantOffset = 0) =>
      toSessionActor('pending', getPendingAccountForWorker(variantOffset)),
  };
}

export function actorToTestUser(actor: SessionActor): TestUser {
  return {
    email: actor.email,
    password: actor.password,
    name: actor.name,
  };
}

export async function createActorSessionContext(
  browser: Browser,
  actor: SessionActor
): Promise<ActorSessionContext> {
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();

  return {
    actor,
    userContext,
    userPage,
  };
}
