/**
 * Reads a verification report JSON file and formats a human-readable Markdown summary.
 *
 * Invoked by: Imported by `scripts/print-verify-report-summary.mjs`.
 * Usage: (library module, not invoked directly)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildVerificationReportSummary,
  isVerificationReportPassing,
  validateVerificationReport,
} from './verification-report-contract.mjs';

export function loadVerificationReport(reportFile) {
  const normalizedReportFile = resolve(String(reportFile));
  return validateVerificationReport(JSON.parse(readFileSync(normalizedReportFile, 'utf8')));
}

export function summarizeVerificationReport(report) {
  const validated = validateVerificationReport(report);
  const summary = buildVerificationReportSummary(validated);

  return {
    ...summary,
    notes: Array.isArray(validated?.notes) ? validated.notes : [],
    releaseGates: Array.isArray(validated?.domains?.releaseGates)
      ? validated.domains.releaseGates
      : [],
    reportFile: String(validated?.reportFile ?? ''),
    reviewers: Array.isArray(validated?.domains?.reviewers) ? validated.domains.reviewers : [],
  };
}

export function formatVerificationReportSummary(report) {
  const summary = summarizeVerificationReport(report);
  const lines = [
    `Verification report: ${summary.reportFile || '(unknown file)'}`,
    `Artifact: ${summary.artifactName}`,
    `Status: ${isVerificationReportPassing(report) ? 'PASS' : 'FAIL'}`,
    `Scope: ${summary.scope}`,
    `Stages: total=${String(summary.totalStages)} passed=${String(summary.passedStages)} failed=${String(summary.failedStages)} skipped=${String(summary.skippedStages)} running=${String(summary.runningStages)} pending=${String(summary.pendingStages)}`,
  ];

  if (summary.owners.length > 0) {
    lines.push(`Owners: ${summary.owners.join(', ')}`);
  }

  if (summary.requiredApprovals.length > 0) {
    lines.push(`Required approvals: ${summary.requiredApprovals.join(', ')}`);
  }

  if (summary.reviewers.length > 0) {
    lines.push(`Reviewers: ${summary.reviewers.join(', ')}`);
  }

  if (summary.releaseGates.length > 0) {
    lines.push(`Release gates: ${summary.releaseGates.join(', ')}`);
  }

  if (summary.notes.length > 0) {
    lines.push(`Notes: ${summary.notes.join(' | ')}`);
  }

  return lines.join('\n');
}

export function readAndFormatVerificationReportSummary(reportFile) {
  return formatVerificationReportSummary(loadVerificationReport(reportFile));
}
