import assert from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

import {
  baselineClassroomPathMigrations,
  findMissingSchemaMarkers,
  LEGACY_WINDOWS_OFFLINE_RETIREMENT_TAG,
  readMigrationLedgerEntriesForBaseline,
  readMigrationLedgerEntries,
} from '../scripts/baseline-cp-migrations.js';

test('baselining uses a migration ledger isolated from OpenPath', async () => {
  const queries: string[] = [];
  const client = {
    async query(query: string) {
      queries.push(query);
      if (query.includes('count(*)::text AS count')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    },
  };

  assert.equal(await baselineClassroomPathMigrations(client as never), 'fresh-schema');
  assert.ok(queries.some((query) => query.includes('drizzle.__classroompath_migrations')));
  assert.equal(
    queries.some((query) => query.includes('drizzle.__drizzle_migrations')),
    false
  );
});

test('reads migration ledger entries with Drizzle-compatible hashes', () => {
  const dir = join(tmpdir(), `cp-migrations-${process.pid}-${Date.now()}`);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({
      entries: [{ tag: '0000_example', when: 123 }],
    })
  );
  writeFileSync(join(dir, '0000_example.sql'), 'select 1;');

  const entries = readMigrationLedgerEntries(dir);

  assert.deepStrictEqual(entries, [
    {
      hash: '354b7196c9ba5fb4b21cf615bb6ec4cd5c07503c34229feef033fc081a8c03f4',
      createdAt: 123,
      tag: '0000_example',
    },
  ]);
});

test('reports missing schema markers before baselining an existing schema', () => {
  const missing = findMissingSchemaMarkers(
    new Set(['cp_organizations.id', 'cp_billing_manual_requests.id']),
    {
      cp_organizations: ['id'],
      cp_billing_manual_requests: ['id', 'resolution_note'],
    }
  );

  assert.deepStrictEqual(missing, ['cp_billing_manual_requests.resolution_note']);
});

test('never baselines the destructive legacy retirement migration', () => {
  const migrationsDir = join(import.meta.dirname, '..', 'drizzle');
  const defaultEntries = readMigrationLedgerEntriesForBaseline(migrationsDir);
  const confirmedEntries = readMigrationLedgerEntriesForBaseline(migrationsDir);

  assert.ok(defaultEntries.some((entry) => entry.tag === '0010_windows_offline_installer'));
  assert.equal(
    defaultEntries.some((entry) => entry.tag === LEGACY_WINDOWS_OFFLINE_RETIREMENT_TAG),
    false
  );
  assert.equal(
    confirmedEntries.some((entry) => entry.tag === LEGACY_WINDOWS_OFFLINE_RETIREMENT_TAG),
    false
  );
});
