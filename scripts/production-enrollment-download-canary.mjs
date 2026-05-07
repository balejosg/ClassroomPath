#!/usr/bin/env node

const DEFAULT_OUTPUT_PATH = 'production-enrollment-download-canary.json';

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { runEnrollmentDownloadCanary } from './enrollment-download-canary.mjs';

export async function runProductionEnrollmentDownloadCanary({
  baseUrl,
  classroomId,
  enrollmentToken,
  expectedLinuxAgentVersion = '',
  outputPath = DEFAULT_OUTPUT_PATH,
  now = () => new Date(),
  fetchImpl = fetch,
}) {
  return runEnrollmentDownloadCanary({
    baseUrl,
    classroomId,
    enrollmentToken,
    expectedLinuxAgentVersion,
    environment: 'production',
    outputPath,
    now,
    fetchImpl,
  });
}

async function main() {
  const evidence = await runProductionEnrollmentDownloadCanary({
    baseUrl: process.env.PRODUCTION_ENROLLMENT_CANARY_BASE_URL,
    classroomId: process.env.CLASSROOM_ID,
    enrollmentToken: process.env.ENROLLMENT_TOKEN,
    expectedLinuxAgentVersion: process.env.OPENPATH_LINUX_AGENT_VERSION,
    outputPath: process.env.PRODUCTION_ENROLLMENT_CANARY_OUTPUT || DEFAULT_OUTPUT_PATH,
  });

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.result !== 'success') {
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
