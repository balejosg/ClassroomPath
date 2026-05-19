#!/usr/bin/env node
// @ts-check

import { isDirectExecution } from './lib/github-actions.mjs';
import { runReleasePreflight } from './lib/release-preflight.mjs';

function render(result) {
  const lines = [
    result.ok ? 'Release preflight passed' : 'Release preflight blocked',
    `next tag: ${result.nextTag || 'n/a'}`,
    '',
    'Checks:',
    ...Object.entries(result.checks).map(
      ([name, check]) => `  - ${name}: ${check.ok ? 'ok' : 'blocked'} - ${check.message}`
    ),
    '',
    'Blockers:',
    ...(result.blockers.length ? result.blockers.map((blocker) => `  - ${blocker}`) : ['  - none']),
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const result = await runReleasePreflight({ argv: process.argv.slice(2) });
  process.stdout.write(render(result));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
