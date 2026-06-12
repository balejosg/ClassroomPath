/**
 * Reads a verification report JSON file and prints a human-readable Markdown summary to stdout for CI annotations.
 *
 * Invoked by: GitHub Actions `ci.yml` workflow; `deployment-foundation.test.ts`.
 * Usage: node scripts/print-verify-report-summary.mjs <report-file>
 */
import { readAndFormatVerificationReportSummary } from './lib/verify-report-consumer.mjs';
import { runCli } from './lib/release-cli.mjs';

export function runPrintVerifyReportSummaryCli(argv = process.argv.slice(2)) {
  const reportFile = argv.find((token) => !token.startsWith('--'));
  if (!reportFile) {
    throw new Error('Usage: node scripts/print-verify-report-summary.mjs <report-file>');
  }

  process.stdout.write(`${readAndFormatVerificationReportSummary(reportFile)}\n`);
  return 0;
}

runCli(runPrintVerifyReportSummaryCli);
