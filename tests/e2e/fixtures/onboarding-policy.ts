import type { Page } from '@playwright/test';

import {
  createOnboardingPolicy,
  type OnboardingOrganizationOption,
  type OnboardingPolicy,
} from '@classroompath/contracts/onboarding-policy';

type TrpcPatchMap = Record<string, unknown>;

interface TrpcMockOptions {
  routeGlob?: string;
  routeMarker?: string;
}

export interface OnboardingPolicyPatch {
  organizations?: OnboardingOrganizationOption[];
  policy: Partial<OnboardingPolicy>;
}

export async function mockTrpcProcedures(
  page: Page,
  patches: TrpcPatchMap,
  options: TrpcMockOptions = {}
): Promise<void> {
  const routeGlob = options.routeGlob ?? '**/cp/trpc/**';
  const routeMarker = options.routeMarker ?? '/cp/trpc/';

  await page.route(routeGlob, async (route) => {
    const url = new URL(route.request().url());
    const markerIndex = url.pathname.indexOf(routeMarker);
    if (markerIndex < 0) {
      await route.continue();
      return;
    }

    const proceduresPart = url.pathname.slice(markerIndex + routeMarker.length);
    const procedures = proceduresPart.split(',').filter(Boolean);
    const response = await route.fetch();
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('application/json')) {
      await route.fulfill({ response });
      return;
    }

    const originalBody: unknown = await response.json();

    const setResultData = (entry: unknown, value: unknown): unknown => {
      if (!entry || typeof entry !== 'object') return entry;
      const e = entry as { result?: { data?: unknown } };
      if (!e.result || typeof e.result !== 'object') return entry;

      const data = (e.result as { data?: unknown }).data;
      if (data && typeof data === 'object' && 'json' in data) {
        (e.result as { data?: { json?: unknown } }).data!.json = value;
      } else {
        (e.result as { data?: unknown }).data = value;
      }

      return entry;
    };

    const patchOne = (entry: unknown, procedure: string): unknown => {
      if (!(procedure in patches)) return entry;
      return setResultData(entry, patches[procedure]);
    };

    const patchedBody = Array.isArray(originalBody)
      ? originalBody.map((entry, index) => patchOne(entry, procedures[index] ?? proceduresPart))
      : patchOne(originalBody, proceduresPart);

    await route.fulfill({ response, json: patchedBody });
  });
}

export async function mockOnboardingPolicy(
  page: Page,
  patch: OnboardingPolicyPatch,
  options: TrpcMockOptions = {}
): Promise<void> {
  const policy = createOnboardingPolicy(patch.policy);

  await mockTrpcProcedures(
    page,
    {
      'onboarding.status': {
        hasMembership: false,
        isWaiting: false,
        organization: null,
        platformAdmin: false,
        billing: null,
        policy,
      },
      'onboarding.policy': policy,
      'onboarding.listOrganizations': patch.organizations ?? [],
    },
    options
  );
}

export async function mockWaitingOnboardingFlow(
  page: Page,
  patch: OnboardingPolicyPatch,
  options: TrpcMockOptions = {}
): Promise<void> {
  const routeGlob = options.routeGlob ?? '**/cp/trpc/**';
  const routeMarker = options.routeMarker ?? '/cp/trpc/';
  const policy = createOnboardingPolicy(patch.policy);
  let isWaiting = false;

  await page.route(routeGlob, async (route) => {
    const url = new URL(route.request().url());
    const markerIndex = url.pathname.indexOf(routeMarker);
    if (markerIndex < 0) {
      await route.continue();
      return;
    }

    const proceduresPart = url.pathname.slice(markerIndex + routeMarker.length);
    const procedures = proceduresPart.split(',').filter(Boolean);

    if (
      procedures.length === 1 &&
      (procedures[0] === 'onboarding.waitForInvitation' ||
        proceduresPart === 'onboarding.waitForInvitation')
    ) {
      isWaiting = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            result: {
              data: {
                success: true,
              },
            },
          },
        ]),
      });
      return;
    }

    const patches: TrpcPatchMap = {
      'onboarding.status': {
        hasMembership: false,
        isWaiting,
        organization: null,
        platformAdmin: false,
        billing: null,
        policy,
      },
      'onboarding.listOrganizations': patch.organizations ?? [],
      'onboarding.waitForInvitation': { success: true },
    };

    const response = await route.fetch();
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('application/json')) {
      await route.fulfill({ response });
      return;
    }

    const originalBody: unknown = await response.json();

    const setResultData = (entry: unknown, value: unknown): unknown => {
      if (!entry || typeof entry !== 'object') return entry;
      const e = entry as { result?: { data?: unknown } };
      if (!e.result || typeof e.result !== 'object') return entry;

      const data = (e.result as { data?: unknown }).data;
      if (data && typeof data === 'object' && 'json' in data) {
        (e.result as { data?: { json?: unknown } }).data!.json = value;
      } else {
        (e.result as { data?: unknown }).data = value;
      }

      return entry;
    };

    const patchOne = (entry: unknown, procedure: string): unknown => {
      if (!(procedure in patches)) return entry;
      return setResultData(entry, patches[procedure]);
    };

    const patchedBody = Array.isArray(originalBody)
      ? originalBody.map((entry, index) => patchOne(entry, procedures[index] ?? proceduresPart))
      : patchOne(originalBody, proceduresPart);

    await route.fulfill({ response, json: patchedBody });
  });
}
