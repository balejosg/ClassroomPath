import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function normalizeStages(report) {
  return Array.isArray(report?.stages) ? report.stages : [];
}

export function loadVerificationReport(reportFile) {
  const normalizedReportFile = resolve(String(reportFile));
  return JSON.parse(readFileSync(normalizedReportFile, 'utf8'));
}

export function summarizeVerificationReport(report) {
  const stages = normalizeStages(report);
  const statusCounts = {
    failed: 0,
    passed: 0,
    pending: 0,
    running: 0,
    skipped: 0,
  };

  for (const stage of stages) {
    const status = String(stage?.status ?? 'pending');
    if (status in statusCounts) {
      statusCounts[status] += 1;
    }
  }

  return {
    failedStages: statusCounts.failed,
    notes: Array.isArray(report?.notes) ? report.notes : [],
    ok: report?.ok === true,
    pendingStages: statusCounts.pending,
    reportFile: String(report?.reportFile ?? ''),
    runningStages: statusCounts.running,
    scope: String(report?.scope ?? 'unknown'),
    skippedStages: statusCounts.skipped,
    totalStages: stages.length,
    passedStages: statusCounts.passed,
  };
}

export function formatVerificationReportSummary(report) {
  const summary = summarizeVerificationReport(report);
  const lines = [
    `Verification report: ${summary.reportFile || '(unknown file)'}`,
    `Status: ${summary.ok ? 'PASS' : 'FAIL'}`,
    `Scope: ${summary.scope}`,
    `Stages: total=${String(summary.totalStages)} passed=${String(summary.passedStages)} failed=${String(summary.failedStages)} skipped=${String(summary.skippedStages)} running=${String(summary.runningStages)} pending=${String(summary.pendingStages)}`,
  ];

  if (summary.notes.length > 0) {
    lines.push(`Notes: ${summary.notes.join(' | ')}`);
  }

  return lines.join('\n');
}

export function readAndFormatVerificationReportSummary(reportFile) {
  return formatVerificationReportSummary(loadVerificationReport(reportFile));
}
