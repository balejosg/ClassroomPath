# ADR 0003: Tenant Isolation Is Application-Layer, Enforced By A Test Backstop

> Status: maintained
> Applies to: ClassroomPath multi-tenant data access over shared OpenPath tables
> Last verified: 2026-07-02
> Source of truth: `docs/adr/0003-tenant-isolation-application-layer.md`

**Decision status:** Accepted
**Date:** 2026-07-02
**Decision makers:** ClassroomPath maintainers

## Context

ClassroomPath is a multi-tenant SaaS wrapper over OpenPath. Organizations (tenants)
share a single PostgreSQL database with the OpenPath API. The OpenPath tables
ClassroomPath reads and writes (mirrored in `api/src/db/openpath.ts`:
`whitelist_groups`, `whitelist_rules`, `classrooms`, `machines`, `schedules`,
`machine_exemptions`, `requests`, `push_subscriptions`, `users`, `roles`) have no
`organization_id` column. OpenPath is the OSS core and must remain agnostic of
ClassroomPath, so it cannot carry an organization concept, an `organization_id`
column, or a session GUC.

ClassroomPath establishes which OpenPath rows belong to a tenant through its own
link tables (`cp_organization_groups`, `cp_organization_classrooms`) and resolves
allowed IDs through `api/src/lib/tenant-access.ts`. The tenant context
(`organizationId`, `userRole`) is attached by `tenantProcedure` in
`api/src/trpc/trpc.ts`. Isolation therefore depends on every tenant-scoped service
calling a tenant-access helper before touching a shared table. A single forgotten
check is a silent cross-tenant data leak with no compile-time or runtime guardrail.

## Decision

Keep tenant isolation at the application layer and make its correctness a test
invariant rather than a database-enforced one.

1. Do NOT use PostgreSQL Row-Level Security (RLS) on the shared OpenPath tables.
2. Mark the `tenantProcedure` family with tRPC `meta({ tenantScoped: true })`; every
   derived procedure inherits the marker.
3. An exhaustive adversarial integration suite enumerates `appRouter._def.procedures`
   at test time and, for every tenant-marked procedure, executes it as tenant B
   against tenant A's seeded resources, asserting rejection (`FORBIDDEN`/`NOT_FOUND`,
   with documented per-case overrides) or, for org-scoped list/per-user/no-op
   procedures, a `200` that neither returns nor mutates tenant A data. A registry
   exhaustiveness check fails the suite when a tenant-marked procedure has no
   registered case, so new endpoints cannot be added un-audited.
4. A source-parsing static guard flags any `api/src/services/` file that imports the
   OpenPath mirror without a tenant-scoping signal, against a small documented
   exemption list of callee-scoped leaf helpers.

## Alternatives Considered

- PostgreSQL RLS with an `organization_id` GUC per request: rejected. It would
  require adding an organization concept to OpenPath's shared tables (a column or a
  session variable read by OpenPath's own queries), violating the mandate that
  OpenPath remain agnostic of ClassroomPath. The OpenPath API shares the same DB and
  connection roles and has no tenant concept; an RLS policy keyed on a CP-set GUC
  would either break OpenPath's own access or be trivially bypassed by OpenPath's
  connection. RLS also cannot express the CP link-table relationships
  (`cp_organization_groups`) without materializing tenant data into the shared schema.
- A single shared query wrapper that force-injects an org filter: rejected. The
  shared tables have no `organization_id` to filter on; the org relationship lives in
  CP link tables and varies per resource kind (group vs classroom vs per-user).

## Consequences

### Positive

- OpenPath stays fully agnostic of ClassroomPath; no shared-schema change.
- A forgotten tenant check becomes a red test (adversarial suite or static guard),
  not a production leak.
- New tenant endpoints are un-ignorable: auto-marked by meta inheritance and forced
  into the case registry.

### Negative

- Isolation is only as strong as the test backstop; there is no database-level
  denial of a cross-tenant query issued outside a scoped service.
- The registry and exemption list require maintenance as procedures/services evolve
  (this is intentional friction that forces review).

### Neutral

- Templates (`cp_group_templates`) are an intentional GLOBAL shared catalog: cross-org
  read/import is a feature, not a leak. Isolation applies to org-owned groups,
  classrooms, rules, schedules, requests, exemptions, machines, users, invitations,
  and per-user push subscriptions.
- Billing and onboarding procedures resolve their org through `protectedProcedure`
  plus entitlement checks and touch only `cp_*` tables, so they sit outside the
  `tenantProcedure` family and its harness by design.
