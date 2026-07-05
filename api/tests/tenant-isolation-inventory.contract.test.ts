import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { appRouter } from '../src/trpc/router.js';
import { enumerateProcedures, NON_TENANT_ALLOWLIST } from './tenant-isolation-manifest.js';

// Pure structural contract test: imports the composed appRouter and reads
// procedure meta. No DB query runs at import (the pg Pool connects lazily), so
// this runs in the unit lane. Its job: every tRPC procedure must be classified
// as either tenant-scoped (meta.tenantScoped === true) or an explicit
// non-tenant procedure. A new endpoint that is neither fails here — it cannot
// be silently added without a reviewer deciding which bucket it belongs to.

void describe('tenant-isolation procedure inventory', () => {
  const procedures = enumerateProcedures(appRouter);

  void it('enumerates the composed appRouter', () => {
    assert.ok(procedures.length >= 100, `expected the full router, got ${procedures.length}`);
  });

  void it('classifies every procedure as tenant-scoped xor non-tenant', () => {
    const unclassified: string[] = [];
    const doubleClassified: string[] = [];

    for (const proc of procedures) {
      const inAllowlist = NON_TENANT_ALLOWLIST.has(proc.path);
      if (proc.tenantScoped && inAllowlist) {
        doubleClassified.push(proc.path);
      }
      if (!proc.tenantScoped && !inAllowlist) {
        unclassified.push(proc.path);
      }
    }

    assert.deepStrictEqual(
      unclassified,
      [],
      `Unclassified procedure(s): ${unclassified.join(', ')}. Add each to the ` +
        `tenantProcedure family (so it inherits meta.tenantScoped) if it touches ` +
        `org-owned data, or to NON_TENANT_ALLOWLIST in ` +
        `tests/tenant-isolation-manifest.ts if it is genuinely global/per-user.`
    );
    assert.deepStrictEqual(
      doubleClassified,
      [],
      `Procedure(s) both tenant-marked and allowlisted: ${doubleClassified.join(', ')}. ` +
        `Remove them from NON_TENANT_ALLOWLIST.`
    );
  });

  void it('confirms the tenant family is actually marked (guards against a meta regression)', () => {
    const marked = procedures.filter((p) => p.tenantScoped).map((p) => p.path);
    for (const expected of [
      'groups.update',
      'classrooms.delete',
      'schedules.create',
      'requests.approve',
      'users.assignRole',
      'templates.publishFromGroup',
      'pendingUsers.approve',
      'push.subscribe',
      'auth.generateResetToken',
    ]) {
      assert.ok(marked.includes(expected), `expected ${expected} to be tenant-marked`);
    }
  });

  void it('confirms non-tenant procedures are NOT marked', () => {
    const marked = new Set(procedures.filter((p) => p.tenantScoped).map((p) => p.path));
    for (const nonTenant of [
      'auth.login',
      'onboarding.createOrganization',
      'healthcheck.live',
      'billing.createCheckout',
      'push.getVapidPublicKey',
    ]) {
      assert.ok(!marked.has(nonTenant), `expected ${nonTenant} NOT to be tenant-marked`);
    }
  });
});
