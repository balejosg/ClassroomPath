import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  discoverMirroredTables,
  extractTableColumns,
  findMissingColumns,
  findUnallowlistedMissingColumns,
  type SchemaMirrorAllowlist,
} from './helpers/schema-mirror-diff.js';

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

void describe('discoverMirroredTables', () => {
  void it('discovers every table declared in api/src/db/openpath.ts', () => {
    const mirroredTables = discoverMirroredTables(CP_MIRROR_PATH);
    const sqlNames = mirroredTables.map((table) => table.sqlName).sort();

    assert.deepStrictEqual(sqlNames, [
      'classrooms',
      'email_verification_tokens',
      'machine_exemptions',
      'machines',
      'password_reset_tokens',
      'push_subscriptions',
      'requests',
      'roles',
      'schedules',
      'users',
      'whitelist_groups',
      'whitelist_rules',
    ]);
  });
});

void describe('findUnallowlistedMissingColumns', () => {
  void it('filters out a column that is allowlisted with a reason', () => {
    const missing = findUnallowlistedMissingColumns(['a', 'b', 'c'], ['a', 'c'], 'fake_table', {
      fake_table: [{ column: 'b', reason: 'test fixture: intentionally omitted' }],
    });

    assert.deepStrictEqual(missing, []);
  });

  void it('still flags a column that is missing but not allowlisted', () => {
    const missing = findUnallowlistedMissingColumns(['a', 'b', 'c'], ['a'], 'fake_table', {
      fake_table: [{ column: 'b', reason: 'test fixture: intentionally omitted' }],
    });

    assert.deepStrictEqual(missing, ['c']);
  });

  void it('throws on a stale allowlist entry (column is no longer missing)', () => {
    assert.throws(
      () =>
        findUnallowlistedMissingColumns(['a', 'b', 'c'], ['a', 'b', 'c'], 'fake_table', {
          fake_table: [{ column: 'b', reason: 'test fixture: no longer missing' }],
        }),
      /Stale allowlist entry/
    );
  });
});

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

const ALLOWLISTED_MISSING_COLUMNS: SchemaMirrorAllowlist = {
  roles: [
    {
      column: 'updated_at',
      reason:
        'CP never reads or writes roles.updated_at. Role rows are mutated via targeted UPDATEs ' +
        '(group membership changes, revoke) that do not track a last-modified timestamp on the CP side.',
    },
    {
      column: 'expires_at',
      reason:
        'KNOWN GAP, not fixed by this guard: OpenPath supports temporary/expiring role grants (see ' +
        'upstream/openpath/api/src/services/user-service-shared.ts:35), but CP role-authorization code ' +
        '(api/src/lib/tenant-access.ts, api/src/lib/openpath-roles.ts) never checks expiry, so an ' +
        'OpenPath-expired role would still be treated as active by CP. Allowlisted pending a follow-up ' +
        'task to mirror this column and enforce expiry in tenant-access.ts.',
    },
  ],
  whitelist_groups: [
    {
      column: 'visibility',
      reason:
        'CP tracks group visibility itself via its own cp_organization_groups.visibility column ' +
        '(api/src/db/schema.ts:207, organization-scoped), not via OpenPath single-tenant ' +
        'whitelist_groups.visibility. Two different visibility models for two different sharing scopes.',
    },
    {
      column: 'owner_user_id',
      reason:
        'Same rationale as visibility above: CP does not use OpenPath single-tenant group-ownership. ' +
        'Ownership within a CP organization is derived from cp_organization_groups plus role membership.',
    },
  ],
  whitelist_rules: [
    {
      column: 'enabled',
      reason:
        'KNOWN GAP, not fixed by this guard: OpenPath supports disabling a single rule without ' +
        'deleting it (upstream/openpath/api/src/db/schema.ts:362, "1=activa ... 0=inhabilitada"), but no ' +
        'CP service that touches whitelistRules (api/src/services/group-rules-*.ts and related) ever ' +
        'reads or writes this column -- CP only has group-level enable/disable, not rule-level. New rules ' +
        'get the DB default (1) so this is harmless today. Allowlisted pending a follow-up task to decide ' +
        'whether to expose rule-level toggling in the CP SPA.',
    },
  ],
  requests: [
    {
      column: 'source',
      reason:
        'KNOWN GAP, not fixed by this guard: OpenPath own student-facing access-request route ' +
        '(upstream/openpath/api/src/routes/public-requests.ts:70-88) writes source/machine_hostname/' +
        'origin_host/origin_page/client_version/error_type as diagnostic context on every request. CP ' +
        'teacher-facing request list (api/src/services/request-read.service.ts, listTenantRequests) ' +
        'selects against CP own Drizzle requests table object, which only returns declared columns, so ' +
        'this diagnostic context is silently dropped before a teacher ever sees it. Allowlisted pending a ' +
        'follow-up task to mirror these 6 columns and surface them in the request-approval UI.',
    },
    {
      column: 'machine_hostname',
      reason: 'Same follow-up as requests.source above -- part of the same diagnostic-context gap.',
    },
    {
      column: 'origin_host',
      reason: 'Same follow-up as requests.source above -- part of the same diagnostic-context gap.',
    },
    {
      column: 'origin_page',
      reason: 'Same follow-up as requests.source above -- part of the same diagnostic-context gap.',
    },
    {
      column: 'client_version',
      reason: 'Same follow-up as requests.source above -- part of the same diagnostic-context gap.',
    },
    {
      column: 'error_type',
      reason: 'Same follow-up as requests.source above -- part of the same diagnostic-context gap.',
    },
  ],
};

void describe('openpath schema mirror contract (all mirrored tables)', () => {
  const mirroredTables = discoverMirroredTables(CP_MIRROR_PATH);

  for (const { exportName, sqlName } of mirroredTables) {
    void describe(`table: ${sqlName} (mirror export '${exportName}')`, () => {
      const upstreamColumns = extractTableColumns(OPENPATH_SCHEMA_PATH, sqlName);
      const mirrorColumns = extractTableColumns(CP_MIRROR_PATH, sqlName);

      void it('parses a non-empty column set from both schema files', () => {
        assert.ok(
          upstreamColumns.length > 0,
          `Expected to parse at least one column from upstream OpenPath '${sqlName}'`
        );
        assert.ok(
          mirrorColumns.length > 0,
          `Expected to parse at least one column from the ClassroomPath '${exportName}' mirror`
        );
      });

      void it('every upstream column exists in the mirror, or is allowlisted with a reason', () => {
        const missing = findUnallowlistedMissingColumns(
          upstreamColumns,
          mirrorColumns,
          sqlName,
          ALLOWLISTED_MISSING_COLUMNS
        );

        assert.deepStrictEqual(
          missing,
          [],
          `ClassroomPath's OpenPath mirror (api/src/db/openpath.ts, export '${exportName}') is ` +
            `missing column(s) present in OpenPath's source of truth ` +
            `(upstream/openpath/api/src/db/schema.ts, table '${sqlName}'): ${missing.join(', ')}. ` +
            `Fix: either (a) add the missing column(s) to the '${exportName}' table in ` +
            `api/src/db/openpath.ts, matching the upstream column definition, then rerun this test; ` +
            `or (b) if ClassroomPath genuinely never needs the column, add an entry with a reason to ` +
            `ALLOWLISTED_MISSING_COLUMNS['${sqlName}'] in ` +
            `api/tests/openpath-schema-mirror.contract.test.ts.`
        );
      });
    });
  }
});
