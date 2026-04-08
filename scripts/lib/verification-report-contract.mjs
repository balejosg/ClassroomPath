export const VERIFICATION_REPORT_VERSION = 2;

function normalizeStageStatus(status) {
  return ['pending', 'running', 'passed', 'failed', 'skipped'].includes(String(status))
    ? String(status)
    : 'pending';
}

export function summarizeVerificationStages(stages = []) {
  const summary = {
    failedStages: 0,
    passedStages: 0,
    pendingStages: 0,
    runningStages: 0,
    skippedStages: 0,
    totalStages: 0,
  };

  for (const stage of Array.isArray(stages) ? stages : []) {
    const status = normalizeStageStatus(stage?.status);
    summary.totalStages += 1;

    if (status === 'failed') summary.failedStages += 1;
    if (status === 'passed') summary.passedStages += 1;
    if (status === 'pending') summary.pendingStages += 1;
    if (status === 'running') summary.runningStages += 1;
    if (status === 'skipped') summary.skippedStages += 1;
  }

  return summary;
}

export function buildVerificationReportSummary(report) {
  const stageSummary = summarizeVerificationStages(report?.stages);
  return {
    ...stageSummary,
    ok: report?.ok === true,
    owners: Array.isArray(report?.domains?.owners) ? report.domains.owners : [],
    requiredApprovals: Array.isArray(report?.domains?.requiredApprovals)
      ? report.domains.requiredApprovals
      : [],
    scope: String(report?.scope ?? 'unknown'),
  };
}

export function validateVerificationReport(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('Verification report must be an object');
  }

  if (report.version !== VERIFICATION_REPORT_VERSION) {
    throw new Error(
      `Unsupported verification report version: ${String(report.version ?? 'unset')}`
    );
  }

  if (!Array.isArray(report.stages)) {
    throw new Error('Verification report stages must be an array');
  }

  if (!report.reportFile || !report.rootDir || !report.startedAt) {
    throw new Error('Verification report is missing required top-level metadata');
  }

  return {
    ...report,
    summary: buildVerificationReportSummary(report),
  };
}

export function isVerificationReportPassing(report) {
  const validated = validateVerificationReport(report);
  return (
    validated.ok === true &&
    validated.summary.failedStages === 0 &&
    validated.summary.runningStages === 0 &&
    validated.summary.pendingStages === 0
  );
}
