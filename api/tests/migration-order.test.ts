import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const projectRoot = join(import.meta.dirname, '..', '..');
const journalPath = join(projectRoot, 'api/drizzle/meta/_journal.json');
const migrationPath = join(projectRoot, 'api/drizzle/0010_windows_offline_installer.sql');
const retirementMigrationPath = join(
  projectRoot,
  'api/drizzle/0011_retire_windows_offline_installer_refs.sql'
);

test('keeps the offline installer migration after the historical ledger watermark', () => {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const migration = journal.entries.find((entry) => entry.tag === '0010_windows_offline_installer');

  assert.ok(migration, 'offline installer migration must be present in the journal');
  assert.ok(
    migration.when > 1783267159039,
    `migration timestamp ${migration.when} must follow the latest historical staging ledger entry`
  );
  assert.match(
    readFileSync(migrationPath, 'utf8'),
    /CREATE TABLE IF NOT EXISTS "cp_windows_offline_download_refs"/u
  );

  const retirementMigration = journal.entries.find(
    (entry) => entry.tag === '0011_retire_windows_offline_installer_refs'
  );
  assert.ok(retirementMigration, 'legacy refs retirement migration must be present in the journal');
  assert.ok(retirementMigration.when > migration.when);
  assert.match(
    readFileSync(retirementMigrationPath, 'utf8'),
    /DROP TABLE IF EXISTS "cp_windows_offline_download_refs"/u
  );
});
