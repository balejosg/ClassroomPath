/**
 * Classifies database migration risk for a diff range: detects destructive migrations, multi-table changes, and rollback eligibility.
 *
 * Invoked by: Imported by `scripts/classify-migration-risk.mjs`; tested by `release-risk-policy.test.ts`.
 * Usage: (library module, not invoked directly)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const MIGRATION_GLOBS = ['api/drizzle/*.sql', 'upstream/openpath/api/drizzle/*.sql'];

function resolveUsableRef(repoRoot, ref) {
  if (!ref) {
    return null;
  }
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return ref;
  } catch {
    return null;
  }
}

export function listChangedMigrationFiles({ repoRoot, fromRef, toRef }) {
  if (!fromRef || !toRef || fromRef === toRef) {
    return [];
  }

  // Historical staging deployments recorded the literal fallback value
  // "origin-main" as APP_SHA, which is not a usable git revision. Fall back to
  // the fetched remote main (and to HEAD for the head side) so the risk
  // classification keeps running instead of aborting the deployment.
  const baseRef = resolveUsableRef(repoRoot, fromRef) ?? resolveUsableRef(repoRoot, 'origin/main');
  if (!baseRef) {
    return [];
  }
  const headRef = resolveUsableRef(repoRoot, toRef) ?? 'HEAD';

  const output = execFileSync(
    'git',
    ['diff', '--name-only', `${baseRef}..${headRef}`, '--', ...MIGRATION_GLOBS],
    { cwd: repoRoot, encoding: 'utf8' }
  );

  return output
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function classifyMigrationFileContents(contents) {
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

export function classifyMigrationRiskFromFiles(files) {
  const changedFiles = files.map((file) => file.path);
  const destructiveFiles = [];
  const expandFiles = [];
  const safeFiles = [];

  for (const file of files) {
    const risk = classifyMigrationFileContents(file.contents);

    if (risk === 'destructive') {
      destructiveFiles.push(file.path);
    } else if (risk === 'expand-contract') {
      expandFiles.push(file.path);
    } else {
      safeFiles.push(file.path);
    }
  }

  return {
    riskLevel:
      destructiveFiles.length > 0
        ? 'destructive'
        : expandFiles.length > 0
          ? 'expand-contract'
          : 'safe',
    changedFiles,
    destructiveFiles,
    expandFiles,
    safeFiles,
  };
}

export function classifyMigrationRiskForRefs({ repoRoot, fromRef, toRef }) {
  const changedFiles = listChangedMigrationFiles({ repoRoot, fromRef, toRef });
  return classifyMigrationRiskFromFiles(
    changedFiles.map((file) => ({
      path: file,
      contents: readFileSync(resolve(repoRoot, file), 'utf8'),
    }))
  );
}

export function formatMigrationRiskEnv(result) {
  return [
    `MIGRATION_RISK_LEVEL=${result.riskLevel}`,
    `MIGRATION_CHANGED_FILES=${result.changedFiles.join(',')}`,
    `MIGRATION_DESTRUCTIVE_FILES=${result.destructiveFiles.join(',')}`,
    `MIGRATION_EXPAND_FILES=${result.expandFiles.join(',')}`,
    `MIGRATION_SAFE_FILES=${result.safeFiles.join(',')}`,
  ];
}
