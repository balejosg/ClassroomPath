#!/usr/bin/env node

import { resolve } from 'node:path';

import {
  classifyMigrationRiskForRefs,
  formatMigrationRiskEnv,
} from './lib/migration-risk-classifier.mjs';

const args = process.argv.slice(2);

function getArg(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return '';
  return args[index + 1] ?? '';
}

const repoRoot = resolve(getArg('--repo-root') || process.cwd());
const fromRef = getArg('--from');
const toRef = getArg('--to');

const result = classifyMigrationRiskForRefs({ repoRoot, fromRef, toRef });

for (const line of formatMigrationRiskEnv(result)) {
  console.log(line);
}
