#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { Report } = require('c8');
const defaultExclude = require('@istanbuljs/schema/default-exclude');
const defaultExtension = require('@istanbuljs/schema/default-extension');

const ROOT_DIR = resolve(import.meta.dirname, '..');
const COVERAGE_DIR = resolve(ROOT_DIR, 'coverage');
const TEMP_DIR = resolve(COVERAGE_DIR, 'tmp');
const TEST_COMMAND =
  'node --import tsx --test --test-concurrency=1 tests/*.test.ts tests/integration/*.test.ts';

function runApiTestsWithV8Coverage() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.env.SHELL ?? '/bin/sh', ['-lc', TEST_COMMAND], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'test',
        NODE_V8_COVERAGE: TEMP_DIR,
      },
    });

    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`Coverage run terminated by signal: ${signal}`));
        return;
      }

      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`Coverage run failed with exit code ${code ?? 1}`));
    });
  });
}

async function writeCoverageReports() {
  const report = new Report({
    reporter: ['text', 'json', 'lcov'],
    reportsDirectory: COVERAGE_DIR,
    tempDirectory: TEMP_DIR,
    exclude: defaultExclude,
    extension: defaultExtension,
    excludeAfterRemap: false,
    include: [],
    resolve: '',
    omitRelative: true,
    allowExternal: false,
    skipFull: false,
    excludeNodeModules: true,
    mergeAsync: false,
    all: false,
  });

  await report.run();
}

async function main() {
  await rm(COVERAGE_DIR, { recursive: true, force: true });
  await mkdir(TEMP_DIR, { recursive: true });

  await runApiTestsWithV8Coverage();
  await writeCoverageReports();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
