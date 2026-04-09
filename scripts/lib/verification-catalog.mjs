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
    patterns: ['^\\.github/workflows/.+\\.ya?ml$'],
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
    name: 'deploy-shell',
    patterns: [
      '^scripts/(?:deploy-.+|rollback-.+|persist-.+|run-staging-release-gate|verify-staging-release-state)\\.sh$',
      '^scripts/lib/(?:deployment-state|release-runtime|release-state|remote-bootstrap|deploy-production-context|deploy-production-runtime)\\.sh$',
    ],
    capabilities: { ciRelevant: true, verificationScope: 'ops-regression' },
    ...releasePolicy(),
  },
  {
    name: 'release-cli',
    patterns: [
      '^scripts/(?:detect-ci-relevant-changes|firefox-release-version|openpath-required-checks|print-verify-report-summary|release-images|resolve-latest-verifier-image|run-ci-regression|verify-full|wait-for-release-candidate)\\.(?:mjs|ts)$',
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
      '^scripts/lib/(?:firefox-release-version|github-actions|openpath-ci-checks|regression-plan|release-candidate|release-cli|release-images|resolve-latest-verifier-image|verification-catalog|verification-report-contract|verify-report-consumer)\\.mjs$',
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
    patterns: ['^scripts/lib/(?:verify-.+|verify-domain-policy)\\.ts$'],
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
      '^tests/(?:deployment|firefox-release-version|openpath-required-checks|release-cli|release-images|resolve-latest-verifier-image|verify-cache|verify-plan|verify-report|verify-runtime|wait-for-release-candidate|workflow-config)\\.test\\.ts$',
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

export const VERIFICATION_STAGE_DEFINITIONS = {
  full: [
    { id: 'test-file-coverage', label: 'Test file coverage inventory', cache: 'diff-safe' },
    { id: 'build', label: 'Build all packages', cache: 'diff-safe' },
    { id: 'static-analysis', label: 'Static analysis', cache: 'diff-safe' },
    { id: 'security-and-size', label: 'Security and size checks', cache: 'diff-safe' },
    { id: 'tests', label: 'Unit and integration tests', cache: 'never' },
    { id: 'coverage-gate', label: 'Changed-file coverage gate', cache: 'diff-safe' },
    { id: 'playwright-e2e', label: 'Playwright E2E', cache: 'never' },
  ],
  'ops-regression': [
    { id: 'format-and-secrets', label: 'Format and secret checks', cache: 'diff-safe' },
    { id: 'ops-regression', label: 'Operational regression', cache: 'diff-safe' },
  ],
  'release-automation': [
    { id: 'format-and-secrets', label: 'Format and secret checks', cache: 'diff-safe' },
    {
      id: 'release-automation-regression',
      label: 'Release automation regression',
      cache: 'diff-safe',
    },
  ],
};

export const REGRESSION_PLAN_DEFINITIONS = {
  ci: {
    files: [
      'tests/agent-docs-consistency.test.ts',
      'tests/deployment.test.ts',
      'tests/firefox-release-version.test.ts',
      'tests/firefox-release-metadata.test.ts',
      'api/tests/openpath-proxy-policy.test.ts',
      'tests/openpath-required-checks.test.ts',
      'tests/release-cli.test.ts',
      'tests/release-evidence.test.ts',
      'tests/release-images.test.ts',
      'tests/resolve-latest-verifier-image.test.ts',
      'tests/release-gate-policy.test.ts',
      'tests/wait-for-release-candidate.test.ts',
    ],
  },
  'workflow-config': {
    files: ['tests/workflow-config.test.ts'],
  },
  'release-automation': {
    include: ['ci', 'workflow-config'],
    files: [
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
    (VERIFICATION_STAGE_DEFINITIONS[scope] ?? []).find((stage) => stage.id === stageId) ?? null
  );
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
