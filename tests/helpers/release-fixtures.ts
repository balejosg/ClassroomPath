import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDir = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(helperDir, '../fixtures/release');

export function readReleaseFixture(relativePath: string): string {
  return readFileSync(resolve(fixtureRoot, relativePath), 'utf8');
}

export function readReleaseJsonFixture<T>(relativePath: string): T {
  return JSON.parse(readReleaseFixture(relativePath)) as T;
}
