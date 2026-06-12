#!/usr/bin/env node

/**
 * Writes a Linux bootstrap canary failure artifact JSON with the error details when a canary probe fails.
 *
 * Invoked by: GitHub Actions `linux-production-bootstrap-canary.yml` workflow on failure.
 * Usage: node scripts/write-linux-bootstrap-canary-failure.mjs
 * Env: CANARY_FAILURE_REASON, CANARY_ARTIFACT_PATH.
 */

import { writeFile } from 'node:fs/promises';
import process from 'node:process';

const artifactPath =
  process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_ARTIFACT ??
  'production-linux-ajax-auto-allow-canary.json';
const boundaryId = process.argv[2] ?? 'unknown';
const message = process.env.FAILURE_BOUNDARY_MESSAGE ?? process.argv.slice(3).join(' ');

if (!message) {
  console.error('FAILURE_BOUNDARY_MESSAGE must be set.');
  process.exit(1);
}

const payload = {
  success: false,
  boundarySource: 'infrastructure',
  failureBoundary: {
    id: boundaryId,
    message,
  },
  diagnosticPhases: [
    {
      id: boundaryId,
      status: 'failed',
      message,
      evidence: {
        artifactWritten: true,
      },
    },
  ],
  artifactWritten: true,
};

await writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
