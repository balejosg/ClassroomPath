#!/usr/bin/env node

/**
 * Writes the production client canary evidence artifact (probe results, timestamps) after a canary run completes.
 *
 * Invoked by: GitHub Actions `production-client-update-canary.yml` workflow.
 * Usage: node scripts/write-production-client-canary-evidence.mjs
 * Env: CANARY_EVIDENCE_DIR.
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

function valueOrNull(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveEvidenceState({ explicitState, jobStatus, billingMode, liveStepsExecuted }) {
  if (
    explicitState === 'live-tested' ||
    explicitState === 'skipped-by-billing-mode' ||
    explicitState === 'advisory-only' ||
    explicitState === 'failed'
  ) {
    return explicitState;
  }

  if (billingMode !== 'stripe' && billingMode !== 'manual_only') {
    return 'skipped-by-billing-mode';
  }

  if (jobStatus === 'success' && liveStepsExecuted) {
    return 'live-tested';
  }

  if (jobStatus === 'success') {
    return 'advisory-only';
  }

  return 'failed';
}

function setGithubOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value)}\n`, 'utf8');
}

const platform = valueOrNull(process.env.CLIENT_CANARY_PLATFORM) ?? 'unknown';
const billingMode = valueOrNull(process.env.CLIENT_CANARY_BILLING_MODE) ?? 'manual_only';
const jobStatus = valueOrNull(process.env.CLIENT_CANARY_JOB_STATUS) ?? 'unknown';
const liveStepsExecuted = process.env.CLIENT_CANARY_LIVE_STEPS_EXECUTED === 'true';
const evidenceState = resolveEvidenceState({
  explicitState: valueOrNull(process.env.CLIENT_CANARY_EVIDENCE_STATE),
  jobStatus,
  billingMode,
  liveStepsExecuted,
});
const outputPath = resolve(
  process.env.CLIENT_CANARY_EVIDENCE_PATH ?? `production-client-canary-evidence-${platform}.json`
);

const evidence = {
  generatedAt: new Date().toISOString(),
  evidence_state: evidenceState,
  platform,
  billing_mode: billingMode,
  job_status: jobStatus,
  live_steps_executed: liveStepsExecuted,
  api_url: valueOrNull(process.env.CLIENT_CANARY_API_URL),
  classroom_id: valueOrNull(process.env.CLIENT_CANARY_CLASSROOM_ID),
  extension_id: valueOrNull(process.env.CLIENT_CANARY_EXTENSION_ID),
  extension_version: valueOrNull(process.env.CLIENT_CANARY_EXTENSION_VERSION),
  bootstrap_manifest_version: valueOrNull(process.env.CLIENT_CANARY_BOOTSTRAP_MANIFEST_VERSION),
  workflow_run_id: valueOrNull(process.env.GITHUB_RUN_ID),
  workflow_sha: valueOrNull(process.env.GITHUB_SHA),
};

writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
setGithubOutput('evidence_state', evidenceState);
setGithubOutput('evidence_path', outputPath);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
