const RELEASE_ENGINEERING = 'release-engineering';
const APPLICATION = 'application';
const STAGING_GATE = 'staging-release-gate';
const PRODUCTION_GATE = 'production-release-gate';

function releasePolicy(overrides = {}) {
  return {
    owner: RELEASE_ENGINEERING,
    requiredApprovals: [RELEASE_ENGINEERING],
    reviewers: [RELEASE_ENGINEERING],
    releaseGates: [STAGING_GATE, PRODUCTION_GATE],
    ...overrides,
  };
}

function applicationPolicy(overrides = {}) {
  return {
    owner: APPLICATION,
    requiredApprovals: [APPLICATION],
    reviewers: [APPLICATION],
    releaseGates: [STAGING_GATE],
    ...overrides,
  };
}

export const VERIFY_DOMAIN_POLICY_DEFINITIONS = [
  {
    name: 'workflow-definition',
    patterns: ['^\\.github/workflows/.+\\.ya?ml$', '^\\.github/actions/.+/action\\.ya?ml$'],
    capabilities: {
      ciRelevant: true,
      releaseAutomationSafe: true,
      verificationScope: 'release-automation',
    },
    ...releasePolicy(),
  },
  {
    name: 'root-package-contract',
    patterns: ['^package(?:-lock)?\\.json$', '^\\.gitmodules$'],
    capabilities: {
      ciRelevant: true,
      releaseAutomationSafe: true,
      verificationScope: 'release-automation',
    },
    ...releasePolicy(),
  },
  {
    name: 'docker-runtime',
    patterns: ['^docker/.+$', '^config/deploy-targets\\.json$'],
    capabilities: { ciRelevant: true, verificationScope: 'ops-regression' },
    ...releasePolicy(),
  },
  {
    name: 'maintained-docs',
    patterns: [
      '^README\\.md$',
      '^AGENTS\\.md$',
      '^docs/(?:INDEX|DOCKER|SECRETS|SESSION_SECURITY_MODEL|verification-matrix)\\.md$',
      '^docs/evaluation/.+\\.md$',
      '^docs/archive/README\\.md$',
      '^docs/plans/README\\.md$',
      '^docs/contracts/.+\\.md$',
      '^docs/runbooks/.+\\.md$',
      '^docs/adr/.+\\.md$',
      '^scripts/verify-docs\\.mjs$',
      '^tests/docs-verification\\.test\\.ts$',
    ],
    capabilities: { ciRelevant: true, verificationScope: 'ops-regression' },
    ...releasePolicy(),
  },
  {
    name: 'deploy-shell',
    patterns: [
      '^scripts/(?:deploy-.+|detect-email-delivery-risk|detect-windows-firefox-risk|rollback-.+|persist-.+|run-staging-release-gate|tag-production-release|verify-production-promotion-ready|verify-staging-release-state)\\.sh$',
      '^scripts/lib/(?:deployment-state|release-risk|release-runtime|release-state|remote-bootstrap|remote-deploy-scaffold|deploy-production-context|deploy-production-runtime|staging-gates)\\.sh$',
    ],
    capabilities: { ciRelevant: true, verificationScope: 'ops-regression' },
    ...releasePolicy(),
  },
  {
    name: 'release-cli',
    patterns: [
      '^scripts/(?:create-production-windows-bootstrap-canary|create-production-linux-bootstrap-canary|detect-ci-relevant-changes|enrollment-download-canary|firefox-release-version|linux-ajax-auto-allow-canary|measure-ci-cache|measure-ci-routing|measure-release-candidate-timings|openpath-required-checks|prepromotion-runner-rehearsal|print-verify-report-summary|production-enrollment-download-canary|release-images|release-risk-cli|release-state-cli|resolve-firefox-release-assets-cache|resolve-latest-verifier-image|resolve-openpath-linux-agent-version|run-ci-regression|summarize-linux-ajax-auto-allow-evidence|verify-full|verify-release-manifest-platforms|wait-for-release-candidate|windows-ajax-auto-allow-canary|write-release-evidence)\\.(?:mjs|ts)$',
    ],
    capabilities: {
      ciRelevant: true,
      releaseAutomationSafe: true,
      verificationScope: 'release-automation',
    },
    ...releasePolicy(),
  },
  {
    name: 'release-library',
    patterns: [
      '^scripts/lib/(?:ajax-auto-allow-canary-harness|ajax-auto-allow-canary-runtime|auto-allow-boundary-evidence|firefox-release-version|github-actions|github-actions-artifacts|github-actions-diagnostic-client|linux-auto-allow-canary-evidence|openpath-ci-checks|prepromotion-runner-rehearsal|promotion-eligibility|regression-plan|release-candidate|release-candidate-components|release-cli|release-evidence|release-images|release-risk|release-risk-policy|release-state-contract|resolve-latest-verifier-image|runner-diagnostic-execution|verification-catalog|verification-report-contract|verify-report-consumer|windows-ajax-auto-allow-runtime|windows-auto-allow-canary-evidence)\\.mjs$',
    ],
    capabilities: {
      ciRelevant: true,
      releaseAutomationSafe: true,
      verificationScope: 'release-automation',
    },
    ...releasePolicy(),
  },
  {
    name: 'verify-library',
    patterns: ['^scripts/lib/(?:verify-.+|verification-stage-runners|verify-domain-policy)\\.ts$'],
    capabilities: {
      ciRelevant: true,
      releaseAutomationSafe: true,
      verificationScope: 'release-automation',
    },
    ...releasePolicy(),
  },
  {
    name: 'release-contract-test',
    patterns: [
      '^tests/(?:ajax-auto-allow-canary-harness|ci-cache-measurement|ci-routing-measurement|deploy-intent|deployment(?:-foundation|-staging-release|-runtime-contracts)?|firefox-release-assets-cache|firefox-release-version|github-actions-artifacts|linux-auto-allow-canary|linux-ajax-auto-allow-canary|openpath-required-checks|prepromotion-runner-rehearsal|production-enrollment-download-canary|promotion-eligibility|release-candidate-components|release-candidate-timings|release-cli|release-evidence|release-images|release-manifest-platforms|release-risk|release-risk-policy|release-state-cli|resolve-latest-verifier-image|staging-gates|verification-pipeline|verify-cache|verify-plan|verify-report|verify-runtime|wait-for-release-candidate|windows-ajax-auto-allow-runtime|workflow(?:-core|-deploy|-production-client-canary|-release-candidate|-config)?)\\.test\\.ts$',
    ],
    capabilities: {
      ciRelevant: true,
      releaseAutomationSafe: true,
      verificationScope: 'release-automation',
    },
    ...releasePolicy(),
  },
  {
    name: 'release-test-helper',
    patterns: ['^tests/helpers/release-fixtures\\.ts$'],
    capabilities: {
      ciRelevant: true,
      releaseAutomationSafe: true,
      verificationScope: 'release-automation',
    },
    ...releasePolicy(),
  },
  {
    name: 'release-fixture',
    patterns: ['^tests/fixtures/release/.+$'],
    capabilities: {
      ciRelevant: true,
      releaseAutomationSafe: true,
      verificationScope: 'release-automation',
    },
    ...releasePolicy(),
  },
  {
    name: 'submodule-link',
    patterns: ['^upstream/openpath$'],
    capabilities: { ciRelevant: true },
    ...releasePolicy(),
  },
  {
    name: 'api-source',
    patterns: ['^api/src/.*\\.(?:ts|tsx)$'],
    capabilities: { ciRelevant: true, needsCoverage: 'api' },
    ...applicationPolicy(),
  },
  {
    name: 'spa-source',
    patterns: ['^react-spa/src/.*\\.(?:ts|tsx)$'],
    capabilities: { ciRelevant: true, needsCoverage: 'spa' },
    ...applicationPolicy(),
  },
  {
    name: 'api-test-or-contract',
    patterns: ['^api/(?:tests|scripts)/.+$', '^tests/e2e/.+$'],
    capabilities: { ciRelevant: true },
    ...applicationPolicy(),
  },
];

export const VERIFICATION_PIPELINE_DEFINITIONS = {
  full: {
    beforeAll: ['cleanup-stale-verification-projects', 'cleanup-verification'],
    stages: [
      {
        id: 'test-file-coverage',
        label: 'Test file coverage inventory',
        cache: 'diff-safe',
        runner: 'test-file-coverage',
        progressLabel: '0/5',
        heading: 'Checking test file coverage...',
      },
      {
        id: 'build',
        label: 'Build all packages',
        cache: 'diff-safe',
        runner: 'build',
        progressLabel: '1/5',
        heading: 'Building all packages...',
        before: ['start-test-postgres'],
        after: ['wait-for-postgres-and-derive-db-env'],
      },
      {
        id: 'static-analysis',
        label: 'Static analysis',
        cache: 'diff-safe',
        runner: 'static-analysis',
        progressLabel: '2/5',
        heading: 'Static analysis (parallel: typecheck, lint, format)...',
      },
      {
        id: 'security-and-size',
        label: 'Security and size checks',
        cache: 'diff-safe',
        runner: 'security-and-size',
        progressLabel: '3/5',
        heading: 'Security and size checks (parallel)...',
      },
      {
        id: 'tests',
        label: 'Unit and integration tests',
        cache: 'never',
        runner: 'tests',
        progressLabel: '4/5',
        heading: 'Running tests...',
      },
      {
        id: 'coverage-gate',
        label: 'Changed-file coverage gate',
        cache: 'diff-safe',
        runner: 'coverage-gate',
        progressLabel: '4/5',
        heading: 'Checking coverage on changed files (if any)...',
      },
      {
        id: 'playwright-e2e',
        label: 'Playwright E2E',
        cache: 'never',
        runner: 'playwright-e2e',
        progressLabel: '5/5',
        heading: 'E2E Playwright tests...',
        before: ['stop-openpath-api', 'kill-orphaned-dev-ports'],
      },
    ],
  },
  'ops-regression': {
    banner: {
      lines: [
        '⚡ OPTIMIZATION: Operational automation-only diff detected',
        '→ Running deployment/workflow regression instead of full product verification',
      ],
    },
    stages: [
      {
        id: 'format-and-secrets',
        label: 'Format and secret checks',
        cache: 'diff-safe',
        runner: 'format-and-secrets',
        progressLabel: '1/2',
        heading: 'Format and secret checks...',
      },
      {
        id: 'ops-regression',
        label: 'Operational regression',
        cache: 'diff-safe',
        runner: 'ops-regression',
        progressLabel: '2/2',
        heading: 'Operational regression...',
      },
    ],
  },
  'release-automation': {
    banner: {
      lines: [
        '⚡ OPTIMIZATION: Release automation-only diff detected',
        '→ Running targeted workflow/release regression instead of full product verification',
      ],
    },
    stages: [
      {
        id: 'format-and-secrets',
        label: 'Format and secret checks',
        cache: 'diff-safe',
        runner: 'format-and-secrets',
        progressLabel: '1/2',
        heading: 'Format and secret checks...',
      },
      {
        id: 'release-automation-regression',
        label: 'Release automation regression',
        cache: 'diff-safe',
        runner: 'release-automation-regression',
        progressLabel: '2/2',
        heading: 'Release automation regression...',
      },
    ],
  },
};

export const VERIFICATION_STAGE_DEFINITIONS = Object.fromEntries(
  Object.entries(VERIFICATION_PIPELINE_DEFINITIONS).map(([scope, pipeline]) => [
    scope,
    pipeline.stages.map(({ after, before, heading, progressLabel, runner, ...stage }) => stage),
  ])
);

export const REGRESSION_PLAN_DEFINITIONS = {
  ci: {
    files: [
      'tests/docs-verification.test.ts',
      'tests/agent-docs-consistency.test.ts',
      'tests/deployment-foundation.test.ts',
      'tests/deployment-staging-release.test.ts',
      'tests/deployment-runtime-contracts.test.ts',
      'tests/firefox-release-version.test.ts',
      'tests/firefox-release-metadata.test.ts',
      'tests/staging-gates.test.ts',
      'api/tests/openpath-proxy-policy.test.ts',
      'tests/openpath-required-checks.test.ts',
      'tests/release-cli.test.ts',
      'tests/release-candidate-components.test.ts',
      'tests/release-candidate-timings.test.ts',
      'tests/release-evidence.test.ts',
      'tests/release-images.test.ts',
      'tests/release-manifest-platforms.test.ts',
      'tests/release-risk.test.ts',
      'tests/release-risk-policy.test.ts',
      'tests/release-state-cli.test.ts',
      'tests/resolve-latest-verifier-image.test.ts',
      'tests/release-gate-policy.test.ts',
      'tests/wait-for-release-candidate.test.ts',
    ],
  },
  'workflow-config': {
    files: [
      'tests/ci-cache-measurement.test.ts',
      'tests/ci-routing-measurement.test.ts',
      'tests/workflow-core.test.ts',
      'tests/workflow-deploy.test.ts',
      'tests/workflow-production-client-canary.test.ts',
      'tests/workflow-release-candidate.test.ts',
    ],
  },
  'release-automation': {
    include: ['ci', 'workflow-config'],
    files: [
      'tests/github-actions-artifacts.test.ts',
      'tests/verification-pipeline.test.ts',
      'tests/verify-cache.test.ts',
      'tests/verify-plan.test.ts',
      'tests/verify-report.test.ts',
      'tests/verify-runtime.test.ts',
    ],
  },
};

export function compileCatalogPattern(pattern) {
  return new RegExp(String(pattern));
}

export function flattenVerifyDomainPolicies(definitions = VERIFY_DOMAIN_POLICY_DEFINITIONS) {
  return definitions.flatMap((definition) =>
    definition.patterns.map((pattern) => ({
      capabilities: definition.capabilities,
      name: definition.name,
      owner: definition.owner,
      pattern: compileCatalogPattern(pattern),
      releaseGates: [...(definition.releaseGates ?? [])],
      requiredApprovals: [...(definition.requiredApprovals ?? [])],
      reviewers: [...(definition.reviewers ?? [])],
    }))
  );
}

export function summarizeVerificationDomains(
  filePaths,
  definitions = VERIFY_DOMAIN_POLICY_DEFINITIONS
) {
  const compiledDefinitions = flattenVerifyDomainPolicies(definitions);
  const matchedDomains = [];

  for (const filePath of filePaths) {
    for (const definition of compiledDefinitions) {
      if (definition.pattern.test(filePath)) {
        matchedDomains.push(definition);
      }
    }
  }

  return {
    ciRelevant:
      matchedDomains.length > 0 &&
      matchedDomains.some((domain) => domain.capabilities.ciRelevant !== false),
    matchedDomains: [...new Set(matchedDomains.map((domain) => domain.name))],
    owners: [...new Set(matchedDomains.map((domain) => domain.owner))],
    releaseGates: [...new Set(matchedDomains.flatMap((domain) => domain.releaseGates ?? []))],
    requiredApprovals: [
      ...new Set(matchedDomains.flatMap((domain) => domain.requiredApprovals ?? [])),
    ],
    reviewers: [...new Set(matchedDomains.flatMap((domain) => domain.reviewers ?? []))],
  };
}

export function getVerificationStageDefinition(scope, stageId) {
  return (
    (VERIFICATION_PIPELINE_DEFINITIONS[scope]?.stages ?? []).find(
      (stage) => stage.id === stageId
    ) ?? null
  );
}

export function getVerificationPipelineDefinition(scope) {
  return VERIFICATION_PIPELINE_DEFINITIONS[scope] ?? null;
}

export function resolveRegressionPlan(name, seen = new Set()) {
  const normalizedName = String(name ?? '').trim();
  if (!normalizedName) {
    throw new Error('Regression plan name cannot be empty');
  }

  if (seen.has(normalizedName)) {
    return [];
  }

  const plan = REGRESSION_PLAN_DEFINITIONS[normalizedName];
  if (!plan) {
    throw new Error(`Unknown regression plan: ${normalizedName}`);
  }

  seen.add(normalizedName);

  const files = [];
  for (const includedPlan of plan.include ?? []) {
    files.push(...resolveRegressionPlan(includedPlan, seen));
  }

  files.push(...(plan.files ?? []));
  return [...new Set(files)];
}
