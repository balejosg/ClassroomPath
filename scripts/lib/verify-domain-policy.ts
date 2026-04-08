import {
  flattenVerifyDomainPolicies as flattenCatalogDomainPolicies,
  VERIFY_DOMAIN_POLICY_DEFINITIONS,
} from './verification-catalog.mjs';

export type VerifyDomainCapabilities = {
  ciRelevant?: boolean;
  needsCoverage?: 'api' | 'spa';
  releaseAutomationSafe?: boolean;
};

export type VerifyDomainPolicy = {
  capabilities: VerifyDomainCapabilities;
  name: string;
  owner: 'application' | 'release-engineering';
  patterns: readonly RegExp[];
  requiredApprovals: string[];
};

export type VerifyFileDomain = {
  capabilities: VerifyDomainCapabilities;
  name: string;
  owner: VerifyDomainPolicy['owner'];
  pattern: RegExp;
  requiredApprovals: string[];
};

export const VERIFY_DOMAIN_POLICIES: VerifyDomainPolicy[] = VERIFY_DOMAIN_POLICY_DEFINITIONS.map(
  (definition) => ({
    capabilities: definition.capabilities,
    name: definition.name,
    owner: definition.owner as VerifyDomainPolicy['owner'],
    patterns: definition.patterns.map((pattern) => new RegExp(pattern)),
    requiredApprovals: [...(definition.requiredApprovals ?? [])],
  })
);

export function flattenVerifyDomainPolicies(
  policies: readonly VerifyDomainPolicy[] = VERIFY_DOMAIN_POLICIES
): VerifyFileDomain[] {
  if (policies === VERIFY_DOMAIN_POLICIES) {
    return flattenCatalogDomainPolicies() as VerifyFileDomain[];
  }

  return policies.flatMap((policy) =>
    policy.patterns.map((pattern) => ({
      capabilities: policy.capabilities,
      name: policy.name,
      owner: policy.owner,
      pattern,
      requiredApprovals: policy.requiredApprovals,
    }))
  );
}
