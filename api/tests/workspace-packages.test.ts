import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const apiDir = dirname(dirname(currentFilePath));
const projectRoot = dirname(apiDir);

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

void describe('internal workspace package boundaries', () => {
  void test('root workspaces declare internal contracts, presenters, and testkit packages', () => {
    const rootPackage = JSON.parse(readProjectFile('package.json')) as { workspaces?: string[] };

    assert.ok(
      rootPackage.workspaces?.includes('contracts'),
      'Root package.json should declare the contracts workspace'
    );
    assert.ok(
      rootPackage.workspaces?.includes('presenters'),
      'Root package.json should declare the presenters workspace'
    );
    assert.ok(
      rootPackage.workspaces?.includes('testkit'),
      'Root package.json should declare the testkit workspace'
    );
  });

  void test('shared onboarding policy is consumed through @classroompath/contracts', () => {
    const onboardingView = readProjectFile('react-spa/src/views/Onboarding.tsx');
    const waitingView = readProjectFile('react-spa/src/views/Waiting.tsx');
    const onboardingService = readProjectFile('api/src/services/onboarding.service.ts');

    assert.match(
      onboardingView,
      /@classroompath\/contracts\/onboarding-policy/,
      'Onboarding view should import the policy contract via @classroompath/contracts'
    );
    assert.match(
      waitingView,
      /@classroompath\/contracts\/onboarding-policy/,
      'Waiting view should import the policy contract via @classroompath/contracts'
    );
    assert.match(
      onboardingService,
      /@classroompath\/contracts\/onboarding-policy/,
      'Onboarding service should import the policy contract via @classroompath/contracts'
    );
    assert.doesNotMatch(
      onboardingView,
      /\.\.\/\.\.\/\.\.\/api\/src\/contracts/,
      'Onboarding view should not reach into api/src for contracts'
    );
    assert.doesNotMatch(
      waitingView,
      /\.\.\/\.\.\/\.\.\/api\/src\/contracts/,
      'Waiting view should not reach into api/src for contracts'
    );
  });

  void test('shared test helpers are consumed through @classroompath/testkit', () => {
    const scenarioBuilder = readProjectFile('api/tests/integration/scenario-builder.ts');
    const harnessIntegration = readProjectFile(
      'api/tests/integration/tenant-api-harness.integration.test.ts'
    );
    const emailService = readProjectFile('api/src/services/email.service.ts');
    const globalSetup = readProjectFile('tests/e2e/setup/global-setup.ts');
    const testEnvironment = readProjectFile('tests/e2e/setup/test-environment.ts');
    const authEmailSpec = readProjectFile('tests/e2e/auth-email.spec.ts');
    const localSinkProvider = readProjectFile(
      'tests/e2e/fixtures/mailboxes/local-sink-provider.ts'
    );

    assert.match(
      scenarioBuilder,
      /@classroompath\/testkit\/tenant-api-harness/,
      'Integration scenario builder should import the tenant harness via @classroompath/testkit'
    );
    assert.match(
      harnessIntegration,
      /@classroompath\/testkit\/tenant-api-harness/,
      'Tenant harness integration test should import the tenant harness via @classroompath/testkit'
    );

    for (const [label, content] of [
      ['email.service.ts', emailService],
      ['global-setup.ts', globalSetup],
      ['test-environment.ts', testEnvironment],
      ['auth-email.spec.ts', authEmailSpec],
      ['local-sink-provider.ts', localSinkProvider],
    ] as const) {
      assert.match(
        content,
        /@classroompath\/testkit\/test-email-sink/,
        `${label} should import the test email sink via @classroompath/testkit`
      );
      assert.doesNotMatch(
        content,
        /api\/src\/lib\/test-email-sink/,
        `${label} should not reach into api/src/lib/test-email-sink directly`
      );
    }
  });

  void test('shared tenant presenters and onboarding dto contracts are consumed through @classroompath/presenters', () => {
    const rootPackage = JSON.parse(readProjectFile('package.json')) as { workspaces?: string[] };
    const presentersPackage = JSON.parse(readProjectFile('presenters/package.json')) as {
      name?: string;
      exports?: Record<string, unknown>;
    };
    const tenantPresenters = readProjectFile('api/src/services/presenters.ts');
    const onboardingService = readProjectFile('api/src/services/onboarding.service.ts');
    const onboardingView = readProjectFile('react-spa/src/views/Onboarding.tsx');
    const onboardingGate = readProjectFile('react-spa/src/app/OnboardingAccessGate.tsx');

    assert.ok(
      rootPackage.workspaces?.includes('presenters'),
      'Root package.json should declare the presenters workspace'
    );
    assert.equal(
      presentersPackage.name,
      '@classroompath/presenters',
      'presenters/package.json should publish @classroompath/presenters'
    );
    assert.ok(
      presentersPackage.exports?.['./tenant-presenters'],
      'The presenters workspace should expose tenant-presenters'
    );
    assert.ok(
      presentersPackage.exports?.['./onboarding'],
      'The presenters workspace should expose onboarding DTOs'
    );
    assert.match(
      tenantPresenters,
      /@classroompath\/presenters\/tenant-presenters/,
      'api/src/services/presenters.ts should re-export or consume tenant presenters via the presenters workspace'
    );
    assert.match(
      onboardingService,
      /@classroompath\/presenters\/onboarding/,
      'onboarding.service.ts should type its shared onboarding status through @classroompath/presenters'
    );
    assert.match(
      onboardingView,
      /@classroompath\/presenters\/onboarding/,
      'Onboarding.tsx should consume shared onboarding DTO types from @classroompath/presenters'
    );
    assert.match(
      onboardingGate,
      /@classroompath\/presenters\/onboarding/,
      'OnboardingAccessGate.tsx should consume shared onboarding DTO types from @classroompath/presenters'
    );
    assert.doesNotMatch(
      onboardingGate,
      /type OnboardingStatusLike =/,
      'OnboardingAccessGate.tsx should not maintain a local onboarding DTO shadow type'
    );
  });
});
