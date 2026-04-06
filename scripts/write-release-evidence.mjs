import { writeFileSync } from 'node:fs';

import { buildReleaseEvidence, renderReleaseEvidenceMarkdown } from './lib/release-evidence.mjs';

const evidence = buildReleaseEvidence(process.env);
const markdown = renderReleaseEvidenceMarkdown(evidence);

writeFileSync('release-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
writeFileSync('release-evidence.md', `${markdown}\n`, 'utf8');
