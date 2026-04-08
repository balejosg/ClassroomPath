export const REGRESSION_PLAN_DEFINITIONS = {
  ci: {
    files: [
      'tests/agent-docs-consistency.test.ts',
      'tests/deployment.test.ts',
      'tests/firefox-release-version.test.ts',
      'tests/firefox-release-metadata.test.ts',
      'tests/openpath-required-checks.test.ts',
      'tests/release-evidence.test.ts',
      'tests/release-images.test.ts',
      'tests/release-gate-policy.test.ts',
      'tests/wait-for-release-candidate.test.ts',
    ],
  },
  'workflow-config': {
    files: ['tests/workflow-config.test.ts'],
  },
  'release-automation': {
    include: ['ci', 'workflow-config'],
    files: ['tests/verify-plan.test.ts', 'tests/verify-report.test.ts'],
  },
};

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
