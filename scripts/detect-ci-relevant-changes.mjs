import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { writeOutputs } from './lib/github-actions.mjs';
import { summarizeVerificationDomains } from './lib/verification-catalog.mjs';

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

function main(argv = process.argv.slice(2)) {
  const changedFiles = parseChangedFiles(argv);
  const summary = summarizeVerificationDomains(changedFiles);

  writeOutputs({
    ci_relevant: summary.ciRelevant ? 'true' : 'false',
    domain_owners: summary.owners.join(','),
    required_approvals: summary.requiredApprovals.join(','),
  });
}

main();
