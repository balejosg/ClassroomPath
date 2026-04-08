import { readAndFormatVerificationReportSummary } from './lib/verify-report-consumer.mjs';

function main(argv = process.argv.slice(2)) {
  const reportFile = argv[0];
  if (!reportFile) {
    throw new Error('Usage: node scripts/print-verify-report-summary.mjs <report-file>');
  }

  process.stdout.write(`${readAndFormatVerificationReportSummary(reportFile)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
