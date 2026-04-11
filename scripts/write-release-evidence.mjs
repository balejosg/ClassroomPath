import { readFileSync, writeFileSync } from 'node:fs';

import { buildReleaseEvidence, renderReleaseEvidenceMarkdown } from './lib/release-evidence.mjs';

const evidenceInputPath = process.env.RELEASE_EVIDENCE_INPUT_PATH;
const evidenceInput = evidenceInputPath
  ? JSON.parse(readFileSync(evidenceInputPath, 'utf8'))
  : process.env;

const evidence = buildReleaseEvidence(evidenceInput);
const markdown = renderReleaseEvidenceMarkdown(evidence);

writeFileSync('release-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
writeFileSync('release-evidence.md', `${markdown}\n`, 'utf8');
