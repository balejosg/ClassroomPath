import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  buildProductionTagIdentity,
  compareProductionTagIdentity,
  extractProductionTagIdentity,
  writeProductionTagIdentityFile,
} from '../scripts/promotion-evidence-cli.mjs';

const productionTagHelperPath = resolve(
  new URL('../scripts/lib/production-tag.sh', import.meta.url).pathname
);

test('production tag identity round-trips the exact release and RC locator', () => {
  const releaseId = 'a'.repeat(64);
  const identity = buildProductionTagIdentity({
    releaseId,
    rcRunId: '123456789',
    classroomPathSha: 'b'.repeat(40),
  });
  const message = [
    'ClassroomPath production release v1.2.3',
    `ClassroomPath-Release-Id: ${identity.releaseId}`,
    `ClassroomPath-RC-Run-Id: ${identity.rcRunId}`,
    `ClassroomPath-SHA: ${identity.classroomPathSha}`,
  ].join('\n');

  assert.deepEqual(extractProductionTagIdentity(message), identity);
});

test('production tag identity rejects missing or conflicting fields', () => {
  assert.throws(
    () => buildProductionTagIdentity({ releaseId: 'a'.repeat(64), rcRunId: '' }),
    /rcRunId is required/
  );
  assert.throws(
    () => extractProductionTagIdentity('ClassroomPath-Release-Id: ' + 'a'.repeat(64)),
    /ClassroomPath-RC-Run-Id/
  );
  assert.throws(
    () =>
      extractProductionTagIdentity(
        [
          `ClassroomPath-Release-Id: ${'a'.repeat(64)}`,
          'ClassroomPath-RC-Run-Id: 123',
          `ClassroomPath-SHA: ${'b'.repeat(40)}`,
          `ClassroomPath-SHA: ${'c'.repeat(40)}`,
        ].join('\n')
      ),
    /duplicate ClassroomPath-SHA/
  );
});

test('writes the exact tag identity as shell-safe promotion inputs', () => {
  const outputPath = join(
    mkdtempSync(join(tmpdir(), 'classroompath-tag-identity-')),
    'identity.env'
  );
  try {
    writeProductionTagIdentityFile(outputPath, {
      releaseId: 'a'.repeat(64),
      rcRunId: '123456789',
      classroomPathSha: 'b'.repeat(40),
    });
    assert.equal(
      readFileSync(outputPath, 'utf8'),
      `RELEASE_ID=${'a'.repeat(64)}\nRC_RUN_ID=123456789\nCLASSROOMPATH_SHA=${'b'.repeat(40)}\n`
    );
  } finally {
    rmSync(outputPath, { force: true });
  }
});

test('classifies an existing annotated tag as idempotent only for the exact identity', () => {
  const expected = {
    releaseId: 'a'.repeat(64),
    rcRunId: '123456789',
    classroomPathSha: 'b'.repeat(40),
  };

  assert.deepEqual(compareProductionTagIdentity(expected, expected), {
    matches: true,
    mismatches: [],
  });
  assert.deepEqual(
    compareProductionTagIdentity({ ...expected, releaseId: 'c'.repeat(64) }, expected),
    { matches: false, mismatches: ['releaseId'] }
  );
});

test('fails closed when the remote tag lookup cannot be completed', () => {
  const result = spawnSync(
    'bash',
    [
      '-c',
      String.raw`set -u
source "$1"
die() { printf '%s\n' "$1" >&2; exit "$2"; }
git() {
  case "$1" in
    rev-parse) return 1 ;;
    ls-remote) return 42 ;;
    *) return 1 ;;
  esac
}
PRODUCTION_TAG_NAME=v1.2.3
PRODUCTION_TAG_TARGET_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
PRODUCTION_TAG_RELEASE_ID=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
PRODUCTION_TAG_RC_RUN_ID=123
PRODUCTION_TAG_CLASSROOMPATH_SHA=cccccccccccccccccccccccccccccccccccccccc
production_tag_reconcile_existing
`,
      'production-tag-remote-lookup-test',
      productionTagHelperPath,
    ],
    { encoding: 'utf-8' }
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unable to inspect origin tag v1\.2\.3/);
});
