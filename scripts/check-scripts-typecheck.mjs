#!/usr/bin/env node
/**
 * Typecheck ratchet for the root `scripts/` + `tests/` tree (not covered by any workspace tsconfig).
 *
 * Runs `tsc -p tsconfig.scripts.json`, counts errors per file, and compares against a frozen
 * per-file baseline (scripts/typecheck-scripts-baseline.json). Fails only when a file's error
 * count regresses (increases) or a new file introduces errors — it never requires fixing the
 * ~800 pre-existing baseline errors. Paydown (fewer errors than baseline) is reported as an
 * improvement but does not fail; run with --update to record a legitimate paydown or a
 * deliberately-added file into the baseline.
 *
 * Invoked by: `npm run verify:scripts-types`; wired into `npm run test:ci-regression` for CI.
 * Usage: node scripts/check-scripts-typecheck.mjs [--update]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptDir);
const TSCONFIG_PATH = resolve(projectRoot, 'tsconfig.scripts.json');
const BASELINE_PATH = resolve(projectRoot, 'scripts/typecheck-scripts-baseline.json');

const TSC_ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/;

/**
 * Whether a tsc-reported file is "owned" by the ratchet — i.e. its error count is what we gate on.
 *
 * We count ONLY the root `scripts/` + `tests/` tree the ratchet exists to guard, and deliberately
 * IGNORE:
 *   - transitively-pulled workspace source (`api/src/**`, `react-spa/**`) — tsc reaches these
 *     through imports in the tests, and their error count depends on whether the workspace `dist`
 *     is built, which is NOT deterministic across CI runs (a build job may or may not have run).
 *     Counting them made the ratchet flap red/green independent of code changes.
 *   - `tests/e2e/**` and `tests/helpers/**` — Playwright end-to-end specs and their fixtures are
 *     tightly coupled to the built application + the Playwright runtime; their typechecking is
 *     Playwright's domain, and (like the workspace source) their counts vary with build state.
 *
 * The result: the ratchet counts only build-state-independent files, so the same commit yields the
 * same counts locally and on every CI run.
 */
export function isRatchetOwnedFile(file) {
  const path = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (path.startsWith('tests/e2e/') || path.startsWith('tests/helpers/')) return false;
  return path.startsWith('scripts/') || path.startsWith('tests/');
}

/**
 * Parses `tsc` diagnostic output into a per-file error count.
 * Only lines matching `path(line,col): error TSxxxx: message` are counted; wrapped detail
 * lines (indented continuations of a multi-line diagnostic) are ignored. Errors in files not
 * owned by the ratchet (see {@link isRatchetOwnedFile}) are dropped so the count is deterministic.
 */
export function parseTscOutput(output) {
  const counts = {};

  for (const line of output.split(/\r?\n/)) {
    const match = TSC_ERROR_LINE.exec(line);
    if (!match) continue;

    const file = match[1].replace(/\\/g, '/');
    if (!isRatchetOwnedFile(file)) continue;
    counts[file] = (counts[file] ?? 0) + 1;
  }

  return counts;
}

/**
 * Runs `tsc -p tsconfig.scripts.json` and returns the per-file error counts.
 * tsc exits non-zero when there are type errors; that is expected and not itself a failure here.
 */
export function runTscScriptsCheck({ cwd = projectRoot, tscPath = TSCONFIG_PATH } = {}) {
  const result = spawnSync(process.execPath, [resolveTscBin(cwd), '-p', tscPath], {
    cwd,
    encoding: 'utf8',
  });

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  if (result.error) {
    throw result.error;
  }

  return parseTscOutput(output);
}

function resolveTscBin(cwd) {
  return resolve(cwd, 'node_modules/typescript/bin/tsc');
}

function sortedCounts(counts) {
  const sorted = {};
  for (const key of Object.keys(counts).sort()) {
    sorted[key] = counts[key];
  }
  return sorted;
}

export function loadBaseline(path = BASELINE_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeBaseline(counts, path = BASELINE_PATH) {
  writeFileSync(path, `${JSON.stringify(sortedCounts(counts), null, 2)}\n`, 'utf8');
}

/**
 * Pure comparison of current per-file error counts against the frozen baseline.
 *
 * - regressions: files present in the baseline whose current error count increased.
 * - newFilesWithErrors: files with errors that are not tracked in the baseline at all.
 * - improvements: files present in the baseline whose current error count decreased
 *   (including files paid down to zero, which no longer appear in currentCounts).
 *
 * Both `regressions` and `newFilesWithErrors` are failure conditions; `improvements` is
 * informational only.
 */
export function compareToBaseline(currentCounts, baselineCounts) {
  const regressions = [];
  const newFilesWithErrors = [];
  const improvements = [];

  const allFiles = new Set([...Object.keys(currentCounts), ...Object.keys(baselineCounts)]);

  for (const file of allFiles) {
    const currentCount = currentCounts[file] ?? 0;
    const inBaseline = Object.prototype.hasOwnProperty.call(baselineCounts, file);

    if (!inBaseline) {
      if (currentCount > 0) {
        newFilesWithErrors.push({ currentCount, file });
      }
      continue;
    }

    const baselineCount = baselineCounts[file];

    if (currentCount > baselineCount) {
      regressions.push({ baselineCount, currentCount, file });
    } else if (currentCount < baselineCount) {
      improvements.push({ baselineCount, currentCount, file });
    }
  }

  const byFile = (a, b) => a.file.localeCompare(b.file);
  regressions.sort(byFile);
  newFilesWithErrors.sort(byFile);
  improvements.sort(byFile);

  return { improvements, newFilesWithErrors, regressions };
}

function printReport({ improvements, newFilesWithErrors, regressions }) {
  if (regressions.length > 0) {
    console.error('\nTypecheck ratchet REGRESSIONS (error count increased vs. baseline):');
    for (const { baselineCount, currentCount, file } of regressions) {
      console.error(`  ${file}: ${baselineCount} -> ${currentCount}`);
    }
  }

  if (newFilesWithErrors.length > 0) {
    console.error('\nTypecheck ratchet NEW FILES WITH ERRORS (not in baseline):');
    for (const { currentCount, file } of newFilesWithErrors) {
      console.error(`  ${file}: ${currentCount} error(s)`);
    }
  }

  if (improvements.length > 0) {
    console.log('\nTypecheck ratchet improvements (paid down vs. baseline, not required):');
    for (const { baselineCount, currentCount, file } of improvements) {
      console.log(`  ${file}: ${baselineCount} -> ${currentCount}`);
    }
    console.log(
      '\nRun `node scripts/check-scripts-typecheck.mjs --update` to record this paydown in the baseline.'
    );
  }
}

function main(argv = process.argv.slice(2)) {
  const shouldUpdate = argv.includes('--update');
  const currentCounts = runTscScriptsCheck();

  if (shouldUpdate) {
    writeBaseline(currentCounts);
    const fileCount = Object.keys(currentCounts).length;
    const errorCount = Object.values(currentCounts).reduce((sum, count) => sum + count, 0);
    console.log(`Updated ${BASELINE_PATH} (${errorCount} errors across ${fileCount} files).`);
    return 0;
  }

  const baselineCounts = loadBaseline();
  const comparison = compareToBaseline(currentCounts, baselineCounts);
  printReport(comparison);

  const hasRegression =
    comparison.regressions.length > 0 || comparison.newFilesWithErrors.length > 0;

  if (hasRegression) {
    console.error(
      '\nverify:scripts-types FAILED: scripts/tests typecheck errors regressed vs. baseline.'
    );
    return 1;
  }

  console.log('verify:scripts-types OK: no new typecheck regressions in scripts/tests.');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
