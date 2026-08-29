import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { test } from 'node:test';

import { resolveClassroomPathMigrationsFolder } from '../scripts/migrate-cp.js';

test('filters deferred legacy retirement from normal migration runs', () => {
  const migrationFolder = resolveClassroomPathMigrationsFolder({});

  try {
    assert.equal(migrationFolder.temporary, true);
    const journal = JSON.parse(
      readFileSync(`${migrationFolder.folder}/meta/_journal.json`, 'utf8')
    ) as { entries: Array<{ tag: string }> };
    assert.equal(
      journal.entries.some((entry) => entry.tag === '0011_retire_windows_offline_installer_refs'),
      false
    );
  } finally {
    rmSync(migrationFolder.folder, { recursive: true, force: true });
  }
});

test('includes deferred legacy retirement only with explicit confirmation', () => {
  const migrationFolder = resolveClassroomPathMigrationsFolder({
    CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED: '1',
  });

  assert.equal(migrationFolder.temporary, false);
  assert.match(migrationFolder.folder, /api[\\/]drizzle$/u);
});
