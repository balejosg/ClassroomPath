export const RELEASE_RISK_POLICY_DEFINITIONS = [
  {
    id: 'openpath-gitlink',
    description:
      'OpenPath submodule promotions can change client and extension delivery contracts.',
    patterns: ['^upstream/openpath$'],
    canaries: ['windows-firefox-canary', 'production-client-update-canary'],
  },
  {
    id: 'openpath-windows-runtime',
    description:
      'Windows client runtime changes must exercise bootstrap and installed-client update paths.',
    patterns: ['^upstream/openpath/windows/'],
    canaries: ['windows-firefox-canary', 'production-client-update-canary'],
  },
  {
    id: 'openpath-linux-runtime',
    description:
      'Linux client runtime changes must exercise the installed-client self-update path.',
    patterns: ['^upstream/openpath/linux/'],
    canaries: ['windows-firefox-canary', 'production-client-update-canary'],
  },
  {
    id: 'openpath-firefox-extension',
    description:
      'Firefox extension delivery changes must keep Windows policy/bootstrap evidence and prod canaries.',
    patterns: ['^upstream/openpath/firefox-extension/'],
    canaries: ['windows-firefox-canary', 'production-client-update-canary'],
  },
  {
    id: 'openpath-api-bootstrap',
    description: 'OpenPath API bootstrap changes can break client enrollment and update contracts.',
    patterns: [
      '^upstream/openpath/api/src/',
      '^upstream/openpath/api/package\\.json$',
      '^upstream/openpath/api/tests/token-delivery\\.test\\.ts$',
    ],
    canaries: ['windows-firefox-canary', 'production-client-update-canary'],
  },
  {
    id: 'classroompath-api-image',
    description:
      'ClassroomPath API image changes can alter the OpenPath API runtime shipped to clients.',
    patterns: ['^docker/Dockerfile\\.api$'],
    canaries: ['windows-firefox-canary', 'production-client-update-canary'],
  },
  {
    id: 'classroompath-email-delivery-runtime',
    description:
      'Transactional email runtime changes must not be promoted while the provider cannot accept live delivery checks.',
    patterns: [
      '^api/src/services/email\\.service\\.ts$',
      '^api/src/config/(?:runtime|billing|shared)\\.ts$',
      '^api/src/config\\.ts$',
      '^config/\\.env\\.example$',
      '^docs/contracts/env\\.md$',
    ],
    canaries: ['email-delivery-preflight'],
  },
  {
    id: 'classroompath-onboarding-runtime',
    description:
      'Authentication and onboarding email flows depend on live transactional email delivery.',
    patterns: [
      '^api/src/trpc/routers/auth',
      '^api/src/services/invitation',
      '^api/src/services/auth-recovery\\.service\\.ts$',
    ],
    canaries: ['email-delivery-preflight'],
  },
  {
    id: 'classroompath-billing-runtime',
    description: 'Billing and paid onboarding changes depend on live transactional email delivery.',
    patterns: ['^api/src/(?:services|config)/billing', '^api/src/trpc/routers/billing'],
    canaries: ['email-delivery-preflight'],
  },
];

export function compileReleaseRiskPolicy(definitions = RELEASE_RISK_POLICY_DEFINITIONS) {
  return definitions.map((definition) => ({
    ...definition,
    compiledPatterns: definition.patterns.map((pattern) => new RegExp(pattern)),
  }));
}

export function matchReleaseRiskRules(changedFile, definitions = RELEASE_RISK_POLICY_DEFINITIONS) {
  const compiledDefinitions = compileReleaseRiskPolicy(definitions);
  return compiledDefinitions.filter((definition) =>
    definition.compiledPatterns.some((pattern) => pattern.test(changedFile))
  );
}

export function evaluateReleaseRiskPaths(
  changedFiles,
  definitions = RELEASE_RISK_POLICY_DEFINITIONS
) {
  const matchedRules = new Map();

  for (const changedFile of changedFiles) {
    for (const rule of matchReleaseRiskRules(changedFile, definitions)) {
      matchedRules.set(rule.id, rule);
    }
  }

  return {
    highRisk: matchedRules.size > 0,
    matchedRules: [...matchedRules.values()],
  };
}

export function evaluateReleaseRiskPathsForCanary(
  changedFiles,
  canary,
  definitions = RELEASE_RISK_POLICY_DEFINITIONS
) {
  return evaluateReleaseRiskPaths(
    changedFiles,
    definitions.filter((definition) => definition.canaries.includes(canary))
  );
}
