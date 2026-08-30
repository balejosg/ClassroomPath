import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { test } from 'node:test';

import { resolveClassroomPathMigrationsFolder } from '../scripts/migrate-cp.js';

const LEGACY_WINDOWS_OFFLINE_RETIREMENT_FLAG =
  '--confirm-windows-offline-installer-legacy-retirement';

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

test('does not authorize deferred legacy retirement from a persisted environment variable', () => {
  const migrationFolder = resolveClassroomPathMigrationsFolder({
    CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED: '1',
  });

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

test('includes deferred legacy retirement only with the invocation CLI flag', () => {
  const migrationFolder = resolveClassroomPathMigrationsFolder(
    { CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED: '1' },
    [LEGACY_WINDOWS_OFFLINE_RETIREMENT_FLAG]
  );

  assert.equal(migrationFolder.temporary, false);
  assert.match(migrationFolder.folder, /api[\\/]drizzle$/u);
});

test('fails closed on unknown migration arguments before resolving a migration folder', () => {
  assert.throws(
    () =>
      resolveClassroomPathMigrationsFolder(
        { CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED: '1' },
        ['--unexpected-migration-switch']
      ),
    /Unknown ClassroomPath migration argument/u
  );
});
