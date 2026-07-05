import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { appRouter } from '../src/trpc/router.js';
import { enumerateProcedures } from './tenant-isolation-manifest.js';
import { CROSS_TENANT_CASES } from './integration/tenant-isolation-cases.js';

// DB-free. Bridges Task 1 (which paths are tenant-scoped) to Task 3/4 (which
// paths have an executable adversarial case). Every tenant-marked procedure
// MUST have exactly one registry entry, and the registry may not name a path
// that no longer exists. New tenant endpoints therefore cannot be merged
// without a registered cross-tenant case.

void describe('tenant-isolation case registry exhaustiveness', () => {
  const tenantPaths = enumerateProcedures(appRouter)
    .filter((p) => p.tenantScoped)
    .map((p) => p.path);
  const registeredPaths = Object.keys(CROSS_TENANT_CASES);

  void it('registers a case for every tenant-scoped procedure', () => {
    const missing = tenantPaths.filter((path) => !(path in CROSS_TENANT_CASES));
    assert.deepStrictEqual(
      missing,
      [],
      `Tenant-scoped procedure(s) with no cross-tenant case: ${missing.join(', ')}. ` +
        `Add an entry to CROSS_TENANT_CASES in tests/integration/tenant-isolation-cases.ts.`
    );
  });

  void it('has no registry entry for a non-existent or non-tenant procedure', () => {
    const tenantPathSet = new Set(tenantPaths);
    const stale = registeredPaths.filter((path) => !tenantPathSet.has(path));
    assert.deepStrictEqual(
      stale,
      [],
      `Registry entries that are not tenant-scoped procedures (renamed/removed?): ${stale.join(', ')}.`
    );
  });

  void it('every entry has a valid shape', () => {
    for (const [path, kase] of Object.entries(CROSS_TENANT_CASES)) {
      assert.ok(typeof kase.input === 'function', `${path}: input must be a builder function`);
      if (kase.kind === 'reject') {
        assert.ok(
          ['FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'BAD_REQUEST'].includes(kase.code),
          `${path}: invalid reject code ${kase.code}`
        );
      } else {
        assert.strictEqual(kase.kind, 'scoped', `${path}: unknown kind`);
        assert.ok(kase.note.length > 0, `${path}: scoped cases require a note`);
      }
    }
  });
});
