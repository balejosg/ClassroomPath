/**
 * Reads per-platform canary artifacts and writes the unified release evidence JSON required for promotion gating.
 *
 * Invoked by: GitHub Actions release and deploy workflows; `release-evidence.test.ts`.
 * Usage: node scripts/write-release-evidence.mjs
 * Env: RELEASE_EVIDENCE_INPUT_PATH, RELEASE_EVIDENCE_OUTPUT_PATH.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { buildReleaseEvidence, renderReleaseEvidenceMarkdown } from './lib/release-evidence.mjs';

const evidenceInputPath = process.env.RELEASE_EVIDENCE_INPUT_PATH;
const evidenceInput = evidenceInputPath
  ? JSON.parse(readFileSync(evidenceInputPath, 'utf8'))
  : process.env;

const evidence = evidenceInput?.release ? evidenceInput : buildReleaseEvidence(evidenceInput);
const markdown = renderReleaseEvidenceMarkdown(evidence);

writeFileSync('release-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
writeFileSync('release-evidence.md', `${markdown}\n`, 'utf8');
