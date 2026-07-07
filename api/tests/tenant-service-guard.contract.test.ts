import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './helpers/strip-comments.js';

// Pure source-text contract test: no DB, no imports of app code. A service that
// imports the OpenPath mirror (db/openpath.js) reaches directly into shared,
// org-agnostic tables. It MUST scope access through api/src/lib/tenant-access.ts
// (or thread organizationId / a TenantProcedureContext). This test flags any
// mirror-touching service lacking that signal, unless it is an explicitly
// documented exemption (a callee-scoped leaf helper, a pure serializer, or
// pre-tenant auth). A new unscoped mirror accessor fails here.
//
// Both the mirror-import check and the scoping-signal check run against
// stripComments(source), not the raw source: a real import or a real
// tenant-scoping reference always lives in code, never only inside a comment.
// Without stripping comments first, a copy-pasted docstring or a
// `// TODO: scope by organizationId` would satisfy hasScopingSignal on an
// otherwise-unscoped service and defeat the guard.

const currentFilePath = fileURLToPath(import.meta.url);
const apiDir = dirname(dirname(currentFilePath));
const servicesDir = resolve(apiDir, 'src/services');

// Mirror access now has two doors: the raw Drizzle mirror (db/openpath.js) and
// the owning repository layer (db/openpath-repos/*). Both static and dynamic
// imports of either count as mirror-touching: a service that reaches shared
// org-agnostic tables through a repository still needs a tenant-scoping signal
// (ADR 0003 -- repositories deliberately carry no tenant logic).
const MIRROR_IMPORT = /(?:from\s*|import\s*\(\s*)'[^']*db\/(?:openpath\.js|openpath-repos\/[^']+)'/;
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
  [
    'schedules/schedule-metadata.service.ts',
    'leaf; loadScheduleMetadataMaps called by callers that scope via assertOrgClassroomAccess/organizationId first',
  ],
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

/**
 * Both matchers below expect `source` to already have comments stripped
 * (via stripComments) — callers strip once per file and reuse the result,
 * rather than each matcher stripping its own copy.
 */
function touchesMirror(source: string): boolean {
  return MIRROR_IMPORT.test(source);
}

function hasScopingSignal(source: string): boolean {
  return SCOPING_SIGNALS.some((re) => re.test(source));
}

void describe('tenant service guard: mirror access must be scoped', () => {
  const files = listServiceFiles(servicesDir).map((full) => ({
    key: relKey(full),
    // Stripped once here, then reused by every check below (touchesMirror,
    // hasScopingSignal, and the staleness re-check) — a real import or a
    // real tenant-scoping reference always lives in code, never only inside
    // a comment, so matching against stripped text removes false passes
    // (and false over-flags) without widening what counts as a signal.
    source: stripComments(readFileSync(full, 'utf8')),
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

  void it('self-check: a comment-only organizationId mention does not count as a scoping signal', () => {
    const raw =
      "import { openpathDb, whitelistRules } from '../db/openpath.js';\n" +
      '// TODO: scope by organizationId\n' +
      '/**\n' +
      ' * @param organizationId copy-pasted from another service, never used below\n' +
      ' */\n' +
      'export function unscopedRead() {\n' +
      '  return openpathDb.select().from(whitelistRules);\n' +
      '}\n';
    const stripped = stripComments(raw);

    assert.ok(touchesMirror(stripped), 'sanity: snippet must count as mirror-touching');
    assert.ok(
      !hasScopingSignal(stripped),
      'a scoping signal that only appears in a comment must not satisfy the guard'
    );
  });

  void it('self-check: a repository import counts as mirror-touching', () => {
    const synthetic =
      "import { createOrReuseRuleAndPublish } from '../db/openpath-repos/whitelist-rules.repo.js';\n" +
      'export const x = 1;\n';
    assert.ok(touchesMirror(synthetic), 'repository imports must count as mirror-touching');
  });

  void it('self-check: a dynamic mirror import counts as mirror-touching', () => {
    const synthetic =
      'export async function lazy() {\n' +
      "  const { openpathDb } = await import('../db/openpath.js');\n" +
      '  return openpathDb;\n' +
      '}\n';
    assert.ok(touchesMirror(synthetic), 'dynamic imports must count as mirror-touching');
  });
});
