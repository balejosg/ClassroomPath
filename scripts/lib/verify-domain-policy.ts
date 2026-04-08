export type VerifyDomainCapabilities = {
  needsCoverage?: 'api' | 'spa';
  releaseAutomationSafe?: boolean;
};

export type VerifyDomainPolicy = {
  capabilities: VerifyDomainCapabilities;
  name: string;
  owner: 'application' | 'release-engineering';
  patterns: readonly RegExp[];
};

export type VerifyFileDomain = {
  capabilities: VerifyDomainCapabilities;
  name: string;
  owner: VerifyDomainPolicy['owner'];
  pattern: RegExp;
};

export const VERIFY_DOMAIN_POLICIES: VerifyDomainPolicy[] = [
  {
    name: 'workflow-definition',
    owner: 'release-engineering',
    patterns: [/^\.github\/workflows\/.+\.ya?ml$/],
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'root-package-contract',
    owner: 'release-engineering',
    patterns: [/^package(?:-lock)?\.json$/],
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'release-cli',
    owner: 'release-engineering',
    patterns: [
      /^scripts\/(?:firefox-release-version|openpath-required-checks|print-verify-report-summary|release-images|resolve-latest-verifier-image|run-ci-regression|verify-full|wait-for-release-candidate)\.(?:mjs|ts)$/,
    ],
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'release-library',
    owner: 'release-engineering',
    patterns: [
      /^scripts\/lib\/(?:firefox-release-version|github-actions|openpath-ci-checks|regression-plan|release-candidate|release-images|resolve-latest-verifier-image|verify-report-consumer)\.mjs$/,
    ],
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'verify-library',
    owner: 'release-engineering',
    patterns: [/^scripts\/lib\/(?:verify-.+|verify-domain-policy)\.ts$/],
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'release-contract-test',
    owner: 'release-engineering',
    patterns: [
      /^tests\/(?:deployment|firefox-release-version|openpath-required-checks|release-images|resolve-latest-verifier-image|verify-plan|verify-report|wait-for-release-candidate|workflow-config)\.test\.ts$/,
    ],
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'release-test-helper',
    owner: 'release-engineering',
    patterns: [/^tests\/helpers\/release-fixtures\.ts$/],
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'release-fixture',
    owner: 'release-engineering',
    patterns: [/^tests\/fixtures\/release\/.+$/],
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'api-source',
    owner: 'application',
    patterns: [/^api\/src\/.*\.(ts|tsx)$/],
    capabilities: { needsCoverage: 'api' },
  },
  {
    name: 'spa-source',
    owner: 'application',
    patterns: [/^react-spa\/src\/.*\.(ts|tsx)$/],
    capabilities: { needsCoverage: 'spa' },
  },
];

export function flattenVerifyDomainPolicies(
  policies: readonly VerifyDomainPolicy[] = VERIFY_DOMAIN_POLICIES
): VerifyFileDomain[] {
  return policies.flatMap((policy) =>
    policy.patterns.map((pattern) => ({
      capabilities: policy.capabilities,
      name: policy.name,
      owner: policy.owner,
      pattern,
    }))
  );
}
