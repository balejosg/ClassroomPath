import assert from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

import {
  findMissingSchemaMarkers,
  readMigrationLedgerEntries,
} from '../scripts/baseline-cp-migrations.js';

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
