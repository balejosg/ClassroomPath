export const VERIFY_DOMAIN_POLICY_DEFINITIONS = [
  {
    name: 'workflow-definition',
    owner: 'release-engineering',
    requiredApprovals: ['release-engineering'],
    patterns: ['^\\.github/workflows/.+\\.ya?ml$'],
    capabilities: { ciRelevant: true, releaseAutomationSafe: true },
  },
  {
    name: 'root-package-contract',
    owner: 'release-engineering',
    requiredApprovals: ['release-engineering'],
    patterns: ['^package(?:-lock)?\\.json$', '^\\.gitmodules$'],
    capabilities: { ciRelevant: true, releaseAutomationSafe: true },
  },
  {
    name: 'docker-runtime',
    owner: 'release-engineering',
    requiredApprovals: ['release-engineering'],
    patterns: ['^docker/.+$', '^config/deploy-targets\\.json$'],
    capabilities: { ciRelevant: true },
  },
  {
    name: 'release-cli',
    owner: 'release-engineering',
    requiredApprovals: ['release-engineering'],
    patterns: [
      '^scripts/(?:detect-ci-relevant-changes|firefox-release-version|openpath-required-checks|print-verify-report-summary|release-images|resolve-latest-verifier-image|run-ci-regression|verify-full|wait-for-release-candidate)\\.(?:mjs|ts)$',
    ],
    capabilities: { ciRelevant: true, releaseAutomationSafe: true },
  },
  {
    name: 'release-library',
    owner: 'release-engineering',
    requiredApprovals: ['release-engineering'],
    patterns: [
      '^scripts/lib/(?:firefox-release-version|github-actions|openpath-ci-checks|regression-plan|release-candidate|release-cli|release-images|resolve-latest-verifier-image|verification-catalog|verification-report-contract|verify-report-consumer)\\.mjs$',
    ],
    capabilities: { ciRelevant: true, releaseAutomationSafe: true },
  },
  {
    name: 'verify-library',
    owner: 'release-engineering',
    requiredApprovals: ['release-engineering'],
    patterns: ['^scripts/lib/(?:verify-.+|verify-domain-policy)\\.ts$'],
    capabilities: { ciRelevant: true, releaseAutomationSafe: true },
  },
  {
    name: 'release-contract-test',
    owner: 'release-engineering',
    requiredApprovals: ['release-engineering'],
    patterns: [
      '^tests/(?:deployment|firefox-release-version|openpath-required-checks|release-cli|release-images|resolve-latest-verifier-image|verify-plan|verify-report|verify-runtime|wait-for-release-candidate|workflow-config)\\.test\\.ts$',
    ],
    capabilities: { ciRelevant: true, releaseAutomationSafe: true },
  },
  {
    name: 'release-test-helper',
    owner: 'release-engineering',
    requiredApprovals: ['release-engineering'],
    patterns: ['^tests/helpers/release-fixtures\\.ts$'],
    capabilities: { ciRelevant: true, releaseAutomationSafe: true },
  },
  {
    name: 'release-fixture',
    owner: 'release-engineering',
    requiredApprovals: ['release-engineering'],
    patterns: ['^tests/fixtures/release/.+$'],
    capabilities: { ciRelevant: true, releaseAutomationSafe: true },
  },
  {
    name: 'submodule-link',
    owner: 'release-engineering',
    requiredApprovals: ['release-engineering'],
    patterns: ['^upstream/openpath$'],
    capabilities: { ciRelevant: true },
  },
  {
    name: 'api-source',
    owner: 'application',
    requiredApprovals: ['application'],
    patterns: ['^api/src/.*\\.(?:ts|tsx)$'],
    capabilities: { ciRelevant: true, needsCoverage: 'api' },
  },
  {
    name: 'spa-source',
    owner: 'application',
    requiredApprovals: ['application'],
    patterns: ['^react-spa/src/.*\\.(?:ts|tsx)$'],
    capabilities: { ciRelevant: true, needsCoverage: 'spa' },
  },
  {
    name: 'api-test-or-contract',
    owner: 'application',
    requiredApprovals: ['application'],
    patterns: ['^api/(?:tests|scripts)/.+$', '^tests/e2e/.+$'],
    capabilities: { ciRelevant: true },
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
      requiredApprovals: [...(definition.requiredApprovals ?? [])],
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
    requiredApprovals: [
      ...new Set(matchedDomains.flatMap((domain) => domain.requiredApprovals ?? [])),
    ],
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
