import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pure source-text contract test: no DB, no imports of app code. A service that
// imports the OpenPath mirror (db/openpath.js) reaches directly into shared,
// org-agnostic tables. It MUST scope access through api/src/lib/tenant-access.ts
// (or thread organizationId / a TenantProcedureContext). This test flags any
// mirror-touching service lacking that signal, unless it is an explicitly
// documented exemption (a callee-scoped leaf helper, a pure serializer, or
// pre-tenant auth). A new unscoped mirror accessor fails here.

const currentFilePath = fileURLToPath(import.meta.url);
const apiDir = dirname(dirname(currentFilePath));
const servicesDir = resolve(apiDir, 'src/services');

const MIRROR_IMPORT = /from\s+'[^']*db\/openpath\.js'/;
const SCOPING_SIGNALS = [
  /from\s+'[^']*lib\/tenant-access\.js'/, // uses a tenant-access helper
  /TenantProcedureContext/, // typed with a tenant context
  /\borganizationId\b/, // threads an org id
];

/**
 * Files that legitimately import the mirror without an inline scoping signal.
 * Each is a callee-scoped leaf (its caller performs the tenant-access check
 * before delegating), a pure serializer (type-only mirror import, no query),
 * or pre-tenant auth. Adding a file here is a reviewed decision: it asserts the
 * file's tenant safety is guaranteed by its callers, not by itself.
 */
const EXEMPTIONS: ReadonlyMap<string, string> = new Map([
  ['auth-registration.service.ts', 'pre-tenant: registration precedes org membership'],
  ['group-rule-serialization.service.ts', 'pure serializer; type-only mirror import, no query'],
  [
    'classrooms/classroom-exemption-read.service.ts',
    'leaf; caller classrooms.listExemptions calls assertOrgClassroomAccess first',
  ],
  [
    'group-role-membership.service.ts',
    'leaf role mutation; callers (group-write/local-link) scope before delegating',
  ],
  ['group-rule-query.service.ts', 'leaf; loadGroupRules called after assertCanViewGroup'],
  [
    'group-rules-create.service.ts',
    'leaf; createOrReuseGroupRule called by tenantGroupRules after assertCanUseGroup',
  ],
  ['group-rules-update.service.ts', 'leaf; deleteGroupRule called after assertCanUseGroup'],
  [
    'group-seeded-upstream-create.service.ts',
    'leaf; invoked inside the scoped group-create workflow',
  ],
  ['schedules/current-group-expiration.service.ts', 'leaf schedule math/read by classroom id'],
  ['schedules/current-group-read.service.ts', 'leaf schedule read by classroom/group id'],
]);

function listServiceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listServiceFiles(full));
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function relKey(fullPath: string): string {
  return relative(servicesDir, fullPath).split('\\').join('/');
}

function touchesMirror(source: string): boolean {
  return MIRROR_IMPORT.test(source);
}

function hasScopingSignal(source: string): boolean {
  return SCOPING_SIGNALS.some((re) => re.test(source));
}

void describe('tenant service guard: mirror access must be scoped', () => {
  const files = listServiceFiles(servicesDir).map((full) => ({
    key: relKey(full),
    source: readFileSync(full, 'utf8'),
  }));

  void it('finds the services directory', () => {
    assert.ok(files.length > 50, `expected many service files, got ${files.length}`);
  });

  void it('every mirror-touching service is scoped or exempt', () => {
    const violations = files
      .filter((f) => touchesMirror(f.source) && !hasScopingSignal(f.source))
      .map((f) => f.key)
      .filter((key) => !EXEMPTIONS.has(key));

    assert.deepStrictEqual(
      violations,
      [],
      `Service(s) importing the OpenPath mirror (db/openpath.js) without a tenant-scoping ` +
        `signal (tenant-access import, TenantProcedureContext, or organizationId): ` +
        `${violations.join(', ')}. Route access through api/src/lib/tenant-access.ts, or — if ` +
        `the file is a callee-scoped leaf — add it to EXEMPTIONS with a justification.`
    );
  });

  void it('exemptions are not stale (each still exists, touches the mirror, and lacks a signal)', () => {
    const byKey = new Map(files.map((f) => [f.key, f.source]));
    const stale: string[] = [];
    for (const key of EXEMPTIONS.keys()) {
      const source = byKey.get(key);
      if (!source) {
        stale.push(`${key} (file removed)`);
        continue;
      }
      if (!touchesMirror(source)) {
        stale.push(`${key} (no longer imports the mirror)`);
        continue;
      }
      if (hasScopingSignal(source)) {
        stale.push(`${key} (now has a scoping signal; drop the exemption)`);
      }
    }
    assert.deepStrictEqual(stale, [], `Stale exemption(s): ${stale.join(', ')}.`);
  });

  void it('self-check: an unscoped mirror snippet would be flagged', () => {
    const synthetic =
      "import { openpathDb, whitelistRules } from '../db/openpath.js';\nexport const x = 1;\n";
    assert.ok(touchesMirror(synthetic), 'sanity: snippet must count as mirror-touching');
    assert.ok(!hasScopingSignal(synthetic), 'sanity: snippet must lack a scoping signal');
  });
});
