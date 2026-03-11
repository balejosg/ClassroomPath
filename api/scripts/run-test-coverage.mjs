#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { Report } = require('c8');
const defaultExclude = require('@istanbuljs/schema/default-exclude');
const defaultExtension = require('@istanbuljs/schema/default-extension');

const ROOT_DIR = resolve(import.meta.dirname, '..');
const COVERAGE_DIR = resolve(ROOT_DIR, 'coverage');
const TEMP_DIR = resolve(COVERAGE_DIR, 'tmp');
const DEFAULT_DB_HOST = process.env.DB_HOST ?? 'localhost';
const DEFAULT_DB_PORT = process.env.DB_PORT ?? '5433';
const DEFAULT_DB_NAME = process.env.DB_NAME ?? 'openpath';
const DEFAULT_DB_USER = process.env.DB_USER ?? 'openpath';
const DEFAULT_DB_PASSWORD = process.env.DB_PASSWORD ?? 'openpath_dev';
const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ??
  `postgres://${DEFAULT_DB_USER}:${DEFAULT_DB_PASSWORD}@${DEFAULT_DB_HOST}:${DEFAULT_DB_PORT}/${DEFAULT_DB_NAME}`;
const COVERAGE_THRESHOLDS = {
  statements: Number.parseFloat(process.env.API_COVERAGE_STATEMENTS ?? '80'),
  lines: Number.parseFloat(process.env.API_COVERAGE_LINES ?? '80'),
  functions: Number.parseFloat(process.env.API_COVERAGE_FUNCTIONS ?? '75'),
  branches: Number.parseFloat(process.env.API_COVERAGE_BRANCHES ?? '70'),
};

async function collectTestFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
      .map((entry) => join(dir, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function listApiTestFiles() {
  const [unitTests, integrationTests] = await Promise.all([
    collectTestFiles(resolve(ROOT_DIR, 'tests')),
    collectTestFiles(resolve(ROOT_DIR, 'tests/integration')),
  ]);

  return [...unitTests, ...integrationTests];
}

function runTestFileWithV8Coverage(testFile) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--test', '--test-concurrency=1', testFile],
      {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV ?? 'test',
          NODE_V8_COVERAGE: TEMP_DIR,
          JWT_SECRET: process.env.JWT_SECRET ?? 'test-jwt-secret',
          DB_HOST: DEFAULT_DB_HOST,
          DB_PORT: DEFAULT_DB_PORT,
          DB_NAME: DEFAULT_DB_NAME,
          DB_USER: DEFAULT_DB_USER,
          DB_PASSWORD: DEFAULT_DB_PASSWORD,
          DATABASE_URL: DEFAULT_DATABASE_URL,
        },
      }
    );

    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (signal) {
        rejectPromise(
          new Error(
            `Coverage run for ${relative(ROOT_DIR, testFile)} terminated by signal: ${signal}`
          )
        );
        return;
      }

      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `Coverage run for ${relative(ROOT_DIR, testFile)} failed with exit code ${code ?? 1}`
        )
      );
    });
  });
}

async function writeCoverageReports() {
  const report = new Report({
    reporter: ['text', 'json', 'json-summary', 'lcov'],
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

async function enforceCoverageThresholds() {
  const summaryPath = resolve(COVERAGE_DIR, 'coverage-summary.json');
  const raw = await readFile(summaryPath, 'utf8');
  const summary = JSON.parse(raw);
  const total = summary.total;

  const checks = [
    ['statements', total.statements?.pct],
    ['lines', total.lines?.pct],
    ['functions', total.functions?.pct],
    ['branches', total.branches?.pct],
  ];

  const failures = checks.filter(([metric, actual]) => {
    const expected = COVERAGE_THRESHOLDS[metric];
    return typeof actual !== 'number' || actual < expected;
  });

  if (failures.length === 0) {
    return;
  }

  const message = failures
    .map(([metric, actual]) => {
      const expected = COVERAGE_THRESHOLDS[metric];
      return `${metric}: expected >= ${expected}, got ${typeof actual === 'number' ? actual.toFixed(2) : 'n/a'}`;
    })
    .join('\n');

  throw new Error(`API coverage thresholds not met:\n${message}`);
}

async function main() {
  await rm(COVERAGE_DIR, { recursive: true, force: true });
  await mkdir(TEMP_DIR, { recursive: true });

  const testFiles = await listApiTestFiles();

  if (testFiles.length === 0) {
    throw new Error('No API test files found for coverage run');
  }

  for (const testFile of testFiles) {
    console.log(`\n[coverage] Running ${relative(ROOT_DIR, testFile)}`);
    await runTestFileWithV8Coverage(testFile);
  }

  await writeCoverageReports();
  await enforceCoverageThresholds();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
