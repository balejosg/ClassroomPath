#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);

function getArg(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return '';
  return args[index + 1] ?? '';
}

const repoRoot = resolve(getArg('--repo-root') || process.cwd());
const fromRef = getArg('--from');
const toRef = getArg('--to');

const migrationGlobs = ['api/drizzle/*.sql', 'upstream/openpath/api/drizzle/*.sql'];

function gitDiffNames() {
  if (!fromRef || !toRef || fromRef === toRef) {
    return [];
  }

  const output = execFileSync(
    'git',
    ['diff', '--name-only', `${fromRef}..${toRef}`, '--', ...migrationGlobs],
    { cwd: repoRoot, encoding: 'utf8' }
  );

  return output
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function classifyFileContents(contents) {
  const destructivePatterns = [
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:TABLE|INDEX|COLUMN|CONSTRAINT)\b/i,
    /\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i,
    /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i,
    /\bALTER\s+TABLE\b[\s\S]*?\bSET\s+DATA\s+TYPE\b/i,
    /\bUPDATE\b[\s\S]*?\bSET\b/i,
  ];

  const expandPatterns = [
    /\bCREATE\s+TABLE\b/i,
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i,
    /\bALTER\s+TABLE\b[\s\S]*?\bADD\s+(?:COLUMN|CONSTRAINT)\b/i,
  ];

  if (destructivePatterns.some((pattern) => pattern.test(contents))) {
    return 'destructive';
  }

  if (expandPatterns.some((pattern) => pattern.test(contents))) {
    return 'expand-contract';
  }

  return 'safe';
}

const changedFiles = gitDiffNames();

const destructiveFiles = [];
const expandFiles = [];
const safeFiles = [];

for (const file of changedFiles) {
  const contents = readFileSync(resolve(repoRoot, file), 'utf8');
  const risk = classifyFileContents(contents);

  if (risk === 'destructive') {
    destructiveFiles.push(file);
  } else if (risk === 'expand-contract') {
    expandFiles.push(file);
  } else {
    safeFiles.push(file);
  }
}

const overallRisk =
  destructiveFiles.length > 0 ? 'destructive' : expandFiles.length > 0 ? 'expand-contract' : 'safe';

console.log(`MIGRATION_RISK_LEVEL=${overallRisk}`);
console.log(`MIGRATION_CHANGED_FILES=${changedFiles.join(',')}`);
console.log(`MIGRATION_DESTRUCTIVE_FILES=${destructiveFiles.join(',')}`);
console.log(`MIGRATION_EXPAND_FILES=${expandFiles.join(',')}`);
console.log(`MIGRATION_SAFE_FILES=${safeFiles.join(',')}`);
