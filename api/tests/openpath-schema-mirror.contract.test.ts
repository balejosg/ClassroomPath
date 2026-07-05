import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractTableColumns, findMissingColumns } from './helpers/schema-mirror-diff.js';

// Pure source-text contract test: no DB connection, no drizzle runtime.
//
// ClassroomPath re-declares (mirrors) OpenPath's `machine_exemptions` table in
// api/src/db/openpath.ts and writes exemptions directly to the shared DB. When
// OpenPath adds a column to that table (e.g. `group_id`), CP's mirror can
// silently lack it and SaaS teachers won't get the feature. This test parses
// both schema files as text and asserts every OpenPath column is also
// declared in CP's mirror. See api/tests/helpers/schema-mirror-diff.ts for why
// this is text-parsing rather than a runtime import of both schema modules.

const currentFilePath = fileURLToPath(import.meta.url);
const apiDir = dirname(dirname(currentFilePath));
const projectRoot = dirname(apiDir);

const OPENPATH_SCHEMA_PATH = resolve(projectRoot, 'upstream/openpath/api/src/db/schema.ts');
const CP_MIRROR_PATH = resolve(projectRoot, 'api/src/db/openpath.ts');

void describe('openpath machine_exemptions schema mirror contract', () => {
  const openpathColumns = extractTableColumns(OPENPATH_SCHEMA_PATH, 'machine_exemptions');
  const cpMirrorColumns = extractTableColumns(CP_MIRROR_PATH, 'machine_exemptions');

  void it('parses a non-empty column set from both schema files', () => {
    assert.ok(
      openpathColumns.length > 0,
      'Expected to parse at least one column from upstream OpenPath machine_exemptions'
    );
    assert.ok(
      cpMirrorColumns.length > 0,
      'Expected to parse at least one column from the ClassroomPath machine_exemptions mirror'
    );
  });

  void it('parses the columns known to exist on machine_exemptions', () => {
    for (const expected of ['machine_id', 'group_id', 'source', 'expires_at']) {
      assert.ok(
        openpathColumns.includes(expected),
        `Expected OpenPath machine_exemptions columns to include '${expected}', got: ${openpathColumns.join(', ')}`
      );
      assert.ok(
        cpMirrorColumns.includes(expected),
        `Expected ClassroomPath machine_exemptions mirror columns to include '${expected}', got: ${cpMirrorColumns.join(', ')}`
      );
    }
  });

  void it('self-check: the comparison helper flags a column dropped from the mirror', () => {
    const mirrorWithoutGroupId = cpMirrorColumns.filter((column) => column !== 'group_id');
    const missing = findMissingColumns(openpathColumns, mirrorWithoutGroupId);

    assert.deepStrictEqual(
      missing,
      ['group_id'],
      'Sanity check: findMissingColumns should flag a column removed from the mirror'
    );
  });

  void it('every OpenPath machine_exemptions column exists in the ClassroomPath mirror', () => {
    const missing = findMissingColumns(openpathColumns, cpMirrorColumns);

    assert.deepStrictEqual(
      missing,
      [],
      `ClassroomPath's machine_exemptions mirror (api/src/db/openpath.ts) is missing column(s) ` +
        `present in OpenPath's source of truth (upstream/openpath/api/src/db/schema.ts): ` +
        `${missing.join(', ')}. Add the missing column(s) to CP's mirror so SaaS teachers get the feature.`
    );
  });
});
