import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './helpers/strip-comments.js';

// Pure source-text contract test: no DB, no app imports. The raw OpenPath
// Drizzle mirror (api/src/db/openpath.ts) has exactly one owning module family:
// api/src/db/openpath-repos/. Everything else that still imports db/openpath.js
// directly is enumerated below with a reason, and the list only shrinks:
// - a NEW raw importer fails this test (route mirror access through a repo);
// - an allowlisted file that stops importing the raw mirror fails the
//   staleness check until its entry is deleted (the ratchet).
// Both static (`from '...'`) and dynamic (`import('...')`) forms count.
// Matching runs on stripComments(source), same as tenant-service-guard.

const currentFilePath = fileURLToPath(import.meta.url);
const apiDir = dirname(dirname(currentFilePath));
const srcDir = resolve(apiDir, 'src');

const MIRROR_RAW_IMPORT = /(?:from\s*|import\s*\(\s*)'[^']*db\/openpath\.js'/;
const REPO_DIR_PREFIX = 'db/openpath-repos/';

/**
 * Files (relative to api/src) allowed to import db/openpath.js directly.
 * Reasons state whether the entry is scheduled for removal by this plan's
 * migration tasks or deliberately left to the post-plan ratchet (read-only).
 * Deleting a migrated file's entry is part of that migration's commit.
 */
const ALLOWED_RAW_IMPORTERS: ReadonlyMap<string, string> = new Map([
  // --- read-only importers: deliberately left to the post-plan ratchet ---
  [
    'lib/tenant-access.ts',
    'read-only tenant scoping over link tables; separate future candidate (ADR 0003)',
  ],
  ['services/classrooms/classroom-exemption-read.service.ts', 'read-only; ratchet'],
  ['services/classrooms/classroom-machine-access.service.ts', 'read-only; ratchet'],
  ['services/classrooms/classroom-read.service.ts', 'read-only (incl. execute SELECT); ratchet'],
  ['services/classrooms/classroom-write-shared.ts', 'read-only shared asserts/presenters; ratchet'],
  ['services/schedules/current-group-expiration.service.ts', 'read-only; ratchet'],
  ['services/schedules/current-group-read.service.ts', 'read-only; ratchet'],
  ['services/schedules/schedule-classroom-read.service.ts', 'read-only; ratchet'],
  ['services/schedules/schedule-teacher-read.service.ts', 'read-only; ratchet'],
  ['services/schedules/schedule-write-shared.service.ts', 'read-only loads/asserts; ratchet'],
]);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function relKey(fullPath: string): string {
  return relative(srcDir, fullPath).split('\\').join('/');
}

function importsRawMirror(strippedSource: string): boolean {
  return MIRROR_RAW_IMPORT.test(strippedSource);
}

void describe('openpath repository boundary: raw mirror imports are owned or allowlisted', () => {
  const files = listSourceFiles(srcDir).map((full) => ({
    key: relKey(full),
    source: stripComments(readFileSync(full, 'utf8')),
  }));

  void it('finds the api source tree', () => {
    assert.ok(files.length > 100, `expected many source files, got ${files.length}`);
  });

  void it('only the repository layer or allowlisted files import db/openpath.js', () => {
    const violations = files
      .filter((f) => importsRawMirror(f.source))
      .map((f) => f.key)
      .filter((key) => !key.startsWith(REPO_DIR_PREFIX))
      .filter((key) => !ALLOWED_RAW_IMPORTERS.has(key));

    assert.deepStrictEqual(
      violations,
      [],
      `File(s) importing the raw OpenPath mirror (db/openpath.js) outside ` +
        `api/src/db/openpath-repos/: ${violations.join(', ')}. Use (or extend) the owning ` +
        `repository in api/src/db/openpath-repos/ instead -- mirror writes must be co-located ` +
        `with their notify/publish side effect. Only if the file is a pre-existing read path ` +
        `may it be added to ALLOWED_RAW_IMPORTERS with a reason.`
    );
  });

  void it('allowlist entries are not stale (each exists and still imports the raw mirror)', () => {
    const byKey = new Map(files.map((f) => [f.key, f.source]));
    const stale: string[] = [];
    for (const key of ALLOWED_RAW_IMPORTERS.keys()) {
      const source = byKey.get(key);
      if (!source) {
        stale.push(`${key} (file removed)`);
        continue;
      }
      if (!importsRawMirror(source)) {
        stale.push(`${key} (no longer imports db/openpath.js -- delete its allowlist entry)`);
      }
    }
    assert.deepStrictEqual(stale, [], `Stale allowlist entr(ies): ${stale.join(', ')}.`);
  });

  void it('self-check: a static raw import would be flagged', () => {
    const synthetic = "import { openpathDb } from '../db/openpath.js';\nexport const x = 1;\n";
    assert.ok(importsRawMirror(synthetic));
  });

  void it('self-check: a dynamic raw import would be flagged', () => {
    const synthetic =
      "export async function lazy() {\n  const mod = await import('../db/openpath.js');\n  return mod;\n}\n";
    assert.ok(importsRawMirror(synthetic));
  });

  void it('self-check: a repository import is NOT a raw-mirror import', () => {
    const synthetic =
      "import { publishWhitelistGroupChanged } from '../db/openpath-repos/publish.js';\nexport const x = 1;\n";
    assert.ok(!importsRawMirror(synthetic));
  });
});
