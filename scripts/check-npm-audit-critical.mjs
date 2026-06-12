/**
 * Reads an `npm audit --json` report and exits non-zero if any critical or high vulnerabilities are present.
 *
 * Invoked by: GitHub Actions `security.yml` workflow via `node scripts/check-npm-audit-critical.mjs <report.json>`.
 * Usage: node scripts/check-npm-audit-critical.mjs <audit-report.json>
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function evaluateNpmAuditCritical(report) {
  const critical = report?.metadata?.vulnerabilities?.critical;
  const high = report?.metadata?.vulnerabilities?.high;

  if (
    !report ||
    typeof report !== 'object' ||
    !report.metadata ||
    typeof report.metadata !== 'object' ||
    !report.metadata.vulnerabilities ||
    typeof report.metadata.vulnerabilities !== 'object' ||
    typeof critical !== 'number' ||
    !Number.isFinite(critical)
  ) {
    return {
      ok: false,
      reason:
        'Audit report is missing metadata.vulnerabilities.critical; refusing to pass a malformed npm audit report.',
    };
  }

  if (critical > 0) {
    return {
      ok: false,
      reason: `npm audit reported ${critical} critical vulnerability${critical === 1 ? '' : 'ies'}.`,
    };
  }

  return {
    ok: true,
    reason: `npm audit reported 0 critical vulnerabilities; high vulnerabilities are informational here (${typeof high === 'number' ? high : 'unknown'} high).`,
  };
}

export function readAndEvaluateNpmAuditCritical(reportPath) {
  let parsed;

  try {
    parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      reason: `Could not read or parse npm audit JSON at ${reportPath}: ${error.message}`,
    };
  }

  return evaluateNpmAuditCritical(parsed);
}

function main(argv = process.argv.slice(2)) {
  const reportPath = argv[0];

  if (!reportPath) {
    console.error('Usage: node scripts/check-npm-audit-critical.mjs <audit-report.json>');
    process.exit(2);
  }

  const result = readAndEvaluateNpmAuditCritical(reportPath);
  const log = result.ok ? console.log : console.error;
  log(result.reason);

  if (!result.ok) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
