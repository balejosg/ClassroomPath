import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDir = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(helperDir, '../fixtures/release');

type JsonRecord = Record<string, unknown>;

function fixturePath(relativePath: string): string {
  return resolve(fixtureRoot, relativePath);
}

export function readReleaseFixture(relativePath: string): string {
  return readFileSync(fixturePath(relativePath), 'utf8');
}

export function readReleaseJsonFixture<T>(relativePath: string): T {
  return JSON.parse(readReleaseFixture(relativePath)) as T;
}

export function buildReleaseFixtureScenario(name: 'latest-success' | 'release-candidate') {
  if (name === 'latest-success') {
    return readReleaseJsonFixture<JsonRecord>('workflow-runs.latest-success.json');
  }

  return readReleaseJsonFixture<JsonRecord>('workflow-runs.release-candidate.json');
}

export function buildReleaseArtifactScenario() {
  return readReleaseJsonFixture<JsonRecord>('artifacts.release-candidate.json');
}

export function buildReleaseManifestScenario() {
  return readReleaseFixture('manifest.release-candidate.env');
}

export function buildOpenPathCiRecoveryScenario() {
  return readReleaseJsonFixture<{
    checkRuns: Array<Record<string, unknown>>;
    workflowJobs: Array<Record<string, unknown>>;
  }>('openpath-ci-recovery.json');
}
