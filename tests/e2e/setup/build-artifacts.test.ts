import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { isBuildStale } from './build-artifacts.js';

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cp-build-artifacts-'));
  tempDirs.push(dir);
  return dir;
}

function writeFileAt(baseDir: string, relativePath: string, timestampMs: number): string {
  const filePath = join(baseDir, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, relativePath);
  const date = new Date(timestampMs);
  utimesSync(filePath, date, date);
  return filePath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe('build artifact freshness', () => {
  test('treats a missing dist entry as stale', () => {
    const workspace = createTempWorkspace();
    writeFileAt(workspace, 'src/server.ts', 1_000);

    assert.equal(
      isBuildStale({
        distEntry: join(workspace, 'dist/server.js'),
        roots: [join(workspace, 'src')],
      }),
      true
    );
  });

  test('treats newer source files as stale', () => {
    const workspace = createTempWorkspace();
    writeFileAt(workspace, 'dist/server.js', 1_000);
    writeFileAt(workspace, 'src/server.ts', 2_000);

    assert.equal(
      isBuildStale({
        distEntry: join(workspace, 'dist/server.js'),
        roots: [join(workspace, 'src')],
      }),
      true
    );
  });

  test('treats newer dist output as fresh', () => {
    const workspace = createTempWorkspace();
    writeFileAt(workspace, 'src/server.ts', 1_000);
    writeFileAt(workspace, 'src/other.ts', 2_000);
    writeFileAt(workspace, 'dist/server.js', 3_000);

    assert.equal(
      isBuildStale({
        distEntry: join(workspace, 'dist/server.js'),
        roots: [join(workspace, 'src')],
      }),
      false
    );
  });
});
