import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const apiDir = dirname(dirname(currentFilePath));
const projectRoot = dirname(apiDir);

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

function listFiles(relativePath: string): string[] {
  const root = resolve(projectRoot, relativePath);
  const result: string[] = [];

  const visit = (currentPath: string, prefix: string) => {
    for (const entry of readdirSync(currentPath)) {
      const entryPath = resolve(currentPath, entry);
      const relativeEntryPath = prefix ? `${prefix}/${entry}` : entry;
      const stats = statSync(entryPath);

      if (stats.isDirectory()) {
        if (entry === '__tests__') continue;
        visit(entryPath, relativeEntryPath);
        continue;
      }

      if (
        relativeEntryPath.endsWith('.ts') ||
        relativeEntryPath.endsWith('.tsx') ||
        relativeEntryPath.endsWith('.css')
      ) {
        result.push(`${relativePath}/${relativeEntryPath}`);
      }
    }
  };

  visit(root, '');
  return result.sort();
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
    assert.ok(
      rootPackage.workspaces?.includes('trpc-contract'),
      'Root package.json should declare the trpc-contract workspace'
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
    const apiEmailSink = readProjectFile('api/src/lib/test-email-sink.ts');
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

    assert.match(
      emailService,
      /\.\.\/lib\/test-email-sink/,
      'email.service.ts should consume the local runtime email sink implementation'
    );
    assert.doesNotMatch(
      emailService,
      /@classroompath\/testkit\/test-email-sink/,
      'email.service.ts should not depend on @classroompath/testkit at runtime'
    );
    assert.doesNotMatch(
      apiEmailSink,
      /@classroompath\/testkit\/test-email-sink/,
      'api/src/lib/test-email-sink.ts should not re-export from @classroompath/testkit'
    );

    for (const [label, content] of [
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

  void test('the SPA consumes AppRouter through @classroompath/trpc-contract instead of api/src', () => {
    const rootPackage = JSON.parse(readProjectFile('package.json')) as { workspaces?: string[] };
    const apiPackage = JSON.parse(readProjectFile('api/package.json')) as {
      exports?: Record<string, unknown>;
    };
    const trpcContractPackage = JSON.parse(readProjectFile('trpc-contract/package.json')) as {
      name?: string;
      exports?: Record<string, unknown>;
    };
    const cpTrpc = readProjectFile('react-spa/src/lib/cp-trpc.ts');
    const dualProvider = readProjectFile('react-spa/src/lib/dual-trpc-provider.tsx');

    assert.ok(
      rootPackage.workspaces?.includes('trpc-contract'),
      'Root package.json should declare the trpc-contract workspace'
    );
    assert.equal(
      trpcContractPackage.name,
      '@classroompath/trpc-contract',
      'trpc-contract/package.json should publish @classroompath/trpc-contract'
    );
    assert.ok(
      trpcContractPackage.exports?.['.'],
      'The trpc-contract workspace should export its contract entrypoint'
    );
    assert.ok(
      apiPackage.exports?.['./trpc-router'],
      'The API workspace should publish a stable trpc-router export'
    );
    assert.match(
      cpTrpc,
      /@classroompath\/trpc-contract/,
      'cp-trpc.ts should import AppRouter through @classroompath/trpc-contract'
    );
    assert.match(
      dualProvider,
      /@classroompath\/trpc-contract/,
      'dual-trpc-provider.tsx should import AppRouter through @classroompath/trpc-contract'
    );
    assert.doesNotMatch(
      cpTrpc,
      /\.\.\/\.\.\/\.\.\/api\/src\/trpc\/router/,
      'cp-trpc.ts should not reach into api/src/trpc/router directly'
    );
    assert.doesNotMatch(
      dualProvider,
      /\.\.\/\.\.\/\.\.\/api\/src\/trpc\/router/,
      'dual-trpc-provider.tsx should not reach into api/src/trpc/router directly'
    );
  });

  void test('OpenPath upstream imports are isolated behind local adapters', () => {
    const reactSpaSourceFiles = listFiles('react-spa/src');
    const apiSourceFiles = listFiles('api/src');
    const upstreamImportPattern =
      /@openpath\/public-auth|@openpath\/public-shell|@openpath\/public-ui|@openpath\/public-google|@openpath\/public-i18n|@openpath\/shared(?:\/roles|\/slug|\/domain)?|@openpath\/openpath\.css/;

    for (const relativePath of reactSpaSourceFiles) {
      const content = readProjectFile(relativePath);
      if (relativePath.startsWith('react-spa/src/openpath/')) {
        assert.match(
          content,
          upstreamImportPattern,
          `${relativePath} should define the local OpenPath adapter boundary`
        );
        continue;
      }

      assert.doesNotMatch(
        content,
        upstreamImportPattern,
        `${relativePath} should consume OpenPath through react-spa/src/openpath/* adapters`
      );
    }

    for (const relativePath of apiSourceFiles) {
      const content = readProjectFile(relativePath);
      if (relativePath.startsWith('api/src/openpath/')) {
        assert.match(
          content,
          upstreamImportPattern,
          `${relativePath} should define the local OpenPath adapter boundary`
        );
        continue;
      }

      assert.doesNotMatch(
        content,
        upstreamImportPattern,
        `${relativePath} should consume OpenPath through api/src/openpath/* adapters`
      );
    }
  });
});
