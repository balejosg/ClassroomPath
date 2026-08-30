import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { closeConnection, db } from '../src/db/index.js';
import {
  LEGACY_WINDOWS_OFFLINE_RETIREMENT_FLAG,
  LEGACY_WINDOWS_OFFLINE_RETIREMENT_TAG,
  shouldApplyLegacyWindowsOfflineRetirement,
} from './baseline-cp-migrations.js';

const sourceMigrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

function createMigrationFolderWithoutDeferredRetirement(): string {
  const filteredDir = mkdtempSync(join(tmpdir(), 'classroompath-cp-migrations-'));
  cpSync(sourceMigrationsDir, filteredDir, { recursive: true });

  const journalPath = join(filteredDir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries?: Array<{ tag: string; when: number }>;
  };
  journal.entries = (journal.entries ?? []).filter(
    (entry) => entry.tag !== LEGACY_WINDOWS_OFFLINE_RETIREMENT_TAG
  );
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  unlinkSync(join(filteredDir, `${LEGACY_WINDOWS_OFFLINE_RETIREMENT_TAG}.sql`));

  return filteredDir;
}

export function resolveClassroomPathMigrationsFolder(
  // Kept as an explicit parameter for callers that already pass runtime env;
  // destructive authorization intentionally never reads it.
  _env: Record<string, string | undefined> = process.env,
  args: readonly string[] = []
): { folder: string; temporary: boolean } {
  const unknownArguments = args.filter(
    (argument) => argument !== LEGACY_WINDOWS_OFFLINE_RETIREMENT_FLAG
  );
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown ClassroomPath migration argument: ${unknownArguments.join(', ')}`);
  }

  if (shouldApplyLegacyWindowsOfflineRetirement(args)) {
    return { folder: sourceMigrationsDir, temporary: false };
  }

  return {
    folder: createMigrationFolderWithoutDeferredRetirement(),
    temporary: true,
  };
}

export async function migrateClassroomPath(
  env: Record<string, string | undefined> = process.env,
  args: readonly string[] = []
): Promise<void> {
  const migrationFolder = resolveClassroomPathMigrationsFolder(env, args);

  try {
    if (migrationFolder.temporary) {
      console.log(
        `[MIGRATIONS] Deferring ${LEGACY_WINDOWS_OFFLINE_RETIREMENT_TAG} until the explicit legacy drain gate`
      );
    }
    await migrate(db, { migrationsFolder: migrationFolder.folder });
  } finally {
    if (migrationFolder.temporary) {
      rmSync(migrationFolder.folder, { recursive: true, force: true });
    }
    await closeConnection();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await migrateClassroomPath(process.env, process.argv.slice(2));
}
