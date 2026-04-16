import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isDirectExecution, writeOutputs } from './lib/github-actions.mjs';
import {
  flattenVerifyDomainPolicies,
  summarizeVerificationDomains,
} from './lib/verification-catalog.mjs';

function parseChangedFiles(argv = process.argv.slice(2)) {
  const changedFilesFile = argv[0];
  if (!changedFilesFile) {
    throw new Error('Usage: node scripts/detect-ci-relevant-changes.mjs <changed-files-path>');
  }

  const content = readFileSync(resolve(changedFilesFile), 'utf8');
  return content
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function summarizeValidationScopes(changedFiles) {
  const domains = flattenVerifyDomainPolicies();
  const matchedDomains = changedFiles.flatMap((filePath) =>
    domains.filter((domain) => domain.pattern.test(filePath))
  );

  return {
    productValidation:
      matchedDomains.length > 0 &&
      matchedDomains.some((domain) => !domain.capabilities.verificationScope),
    opsRegression: matchedDomains.some(
      (domain) => domain.capabilities.verificationScope === 'ops-regression'
    ),
    releaseAutomation: matchedDomains.some(
      (domain) => domain.capabilities.verificationScope === 'release-automation'
    ),
  };
}

export function detectCiRelevantChanges(changedFiles) {
  const summary = summarizeVerificationDomains(changedFiles);
  const scopes = summarizeValidationScopes(changedFiles);

  return {
    ci_relevant: summary.ciRelevant ? 'true' : 'false',
    product_validation: scopes.productValidation ? 'true' : 'false',
    ops_regression: scopes.opsRegression ? 'true' : 'false',
    release_automation: scopes.releaseAutomation ? 'true' : 'false',
    domain_owners: summary.owners.join(','),
    release_gates: summary.releaseGates.join(','),
    required_approvals: summary.requiredApprovals.join(','),
    reviewers: summary.reviewers.join(','),
  };
}

function main(argv = process.argv.slice(2)) {
  writeOutputs(detectCiRelevantChanges(parseChangedFiles(argv)));
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  main();
}
