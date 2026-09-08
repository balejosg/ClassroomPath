# Production Executor Contract

> Status: maintained
> Applies to: production deployment and application recovery
> Last verified: 2026-09-08
> Source of truth: executor scripts and focused deployment tests

## Execution ownership

| Surface                                                                      | Classification  | Runtime                                                            |
| ---------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| Payload resolution, RC evidence, artifact transport                          | RUNNER_ONLY     | Operator/runner Node and Git                                       |
| Phase orchestration, Git checkout, file operations, HTTP probes              | HOST_PRIMITIVE  | Bash, Git, curl, core utilities                                    |
| Container pulls, migration runner, container replacement                     | REMOTE_CRITICAL | Docker daemon and Compose                                          |
| Bundle validation, runtime projection, release-state CLI, semantic readiness | VERIFIER_IMAGE  | Node inside an immutable verifier image                            |
| Recovery artifact and previous release selection                             | REMOTE_CRITICAL | Persisted independent recovery shell closure and previous verifier |
| Optional host Node selection                                                 | REMOVE          | Production always uses the shell migration classifier              |

The executable host inventory is `PRODUCTION_HOST_REQUIRED_COMMANDS` in
`scripts/lib/production-host-contract.sh`. Docker/Compose access, filesystem access,
space, and registry connectivity are checked before the switch. Host Node, npm,
and application dependencies are not required. The verifier package check executes
each critical CLI entrypoint with `--help`, a timeout, and bounded output. The RC
workflow and remote preflight already run that check inside the selected image.

## Preparation and mutation

```text
RESOLVE -> PREFLIGHT -> PREPARE
                       |
                       v
          SWITCHING (mutation boundary)
                       |
          install prepared config/assets
                       |
             migrate -> switch containers
                       |
              ACTIVATED_UNVERIFIED
                       |
       health HTTP 200 + ready HTTP 200/ready=true
                       |
        live runtime identity -> VERIFIED
                       |
       activate current -> persist COMMITTED
```

Preparation persists the candidate bundle and validates a private candidate config
file. It prepares an immutable Firefox asset generation without changing the active
asset pointer. Only after the durable boundary marker is written may the executor
publish the prepared configuration and asset pointer. Candidate config files have
mode 0600 and are removed by entrypoint EXIT cleanup.

Adapters are called in Bash conditional contexts. Every required operation must
explicitly propagate errors; `set -e` alone does not protect these calls. The
fault-injection tests execute the actual shell adapters to guard this property.

## State, recovery, and diagnostics

Supported phases are `PREPARED`, `SWITCHING`, `ACTIVATED_UNVERIFIED`, `VERIFIED`,
`COMMITTED`, `FAILED`, `ROLLING_BACK`, and `ROLLED_BACK`. Invalid transitions fail.
The atomic phase marker is authoritative; secondary history failures cannot undo
an already durable transition. A failed terminal state write cannot publish a
successful rollback result. Recovery ledger identity uses the verified previous
bundle SHA, including hosts without legacy state files.

Recovery uses the independent, preflighted artifact persisted before the boundary,
the durable previous release ID, stored bundle and contract, and previous verifier.
It does not select a replacement from candidate helpers or mutable remote metadata.
Legacy-only state fails the v2 rollback preflight; it is not silently reconstructed
into an authoritative bundle.

Post-switch diagnostics and the existing stable fallback remain required even on
failure. Phase evidence retains requested/current/previous identity, failure point,
and recovery outcome. A valid committed runtime with a failed secondary ledger
append remains committed; the command failure indicates incomplete evidence and
must not be interpreted as proof that the previous runtime is serving.

## Migration compatibility and evidence limits

Application recovery does not restore the database. The existing migration-risk
classifier and backup policy are described in
[`ADR 0002`](../adr/0002-release-risk-gating.md). A backup reference alone is not
proof that the previous application supports a partially migrated schema. This
remains an explicit acceptance gap: per-release backward-compatibility evidence or
a separate database recovery procedure is required for such a claim.

`tests/production-adapter-failures.test.ts` exercises adapter error propagation,
phase markers, named fault reachability, recovery decisions, and pointer seams.
It is imported by the canonical production fault suite. HTTP tests use a local
HTTP server; projection tests exercise real env-file preparation/publication;
package tests execute copied first-party CLI code and reject broken entrypoints.
Docker, migration, state-CLI, and recovery seams in the adapter matrix are test
doubles. They are not proof of an actual container or database restoration.

Local checks do not prove the built verifier image, an isolated minimal host,
production rollback, or real Windows behavior. New operational evidence must bind
the tested commit, bundle, verifier digest, and independent recovery artifact.
Historical successful promotions do not prove later executor changes.
