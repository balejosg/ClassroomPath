# ClassroomPath Windows offline installer migration

Status: implemented locally; staging, drain, and destructive retirement pending authorization
Issue: `balejosg/ClassroomPath#158`
Authoritative specification: issue comment `5413011516`
OpenPath contract inspected: `fe253a94053eafc5356b7a6c6c24b109df599d15`
ClassroomPath starting SHA: `4d9564eb21e03e5427e092a4e9ff0fd8f4f501e4`

## Decision

ClassroomPath remains the tenant-aware wrapper. It keeps its authenticated tRPC
procedure and institution policy, then calls the documented OpenPath HTTP/tRPC
surface with the same bearer access token. OpenPath re-authenticates the request
and performs the classroom authorization at its own boundary.

ClassroomPath does not read OpenPath tables or files and does not call OpenPath
artifact, reference, enrollment-ticket, overlay, or template primitives.

The public download path is proxied by the gateway:

```text
ClassroomPath session/policy
  -> POST /trpc/windowsOfflineInstaller.generate (OpenPath, Bearer)
  -> GET /api/windows-offline-installer/download?ref=<opaque>
```

The wrapper action keeps only presentation metadata. Each explicit click invokes
`generate` again; the returned href is assigned only for the immediate download
navigation and is then cleared.

## OpenPath contract used

Minimum compatible OpenPath pin recorded for this migration:

```text
fe253a94053eafc5356b7a6c6c24b109df599d15
```

This is the final deployed-compatible `main` commit inspected locally. Its
documentation and implementation agree on the following public contract:

```http
POST /trpc/windowsOfflineInstaller.generate
Authorization: Bearer <teacher access token>
Content-Type: application/json
```

```json
{ "classroomId": "<id>" }
```

Successful metadata contains exactly these safe fields:

```json
{
  "fileName": "...",
  "version": "...",
  "sha256": "<64 lowercase hex>",
  "tokenExpiresAt": "...",
  "downloadUrl": ".../api/windows-offline-installer/download?ref=<opaque>",
  "downloadExpiresAt": "..."
}
```

Every generation mints a new opaque reference. The wrapper never persists or
logs the reference, complete URL, enrollment token, JWT, authorization header,
cookie, or personalized payload.

The canonical download route is:

```http
GET /api/windows-offline-installer/download?ref=<opaque>
```

Its terminal semantics are:

| Condition                                |         Status |
| ---------------------------------------- | -------------: |
| missing or malformed reference           |            400 |
| unknown or invalid well-formed reference |            404 |
| expired reference                        |            410 |
| exhausted reference                      |            410 |
| consumed reference                       |            410 |
| valid reference and verified artifact    | 200 attachment |

OpenPath owns the template verification, personalization, artifact storage,
reference lifecycle, binary route, cleanup, core readiness, and core canary.
ClassroomPath consumes the readiness capability signal and only adds gateway,
tenant, UX, and wrapper-observability behavior.

## Pre-cleanup inventory

This inventory was created before removing any legacy implementation. “Remove”
means no replacement is retained in ClassroomPath. “Migrate then remove” means
the code/data can disappear only after canonical traffic and the legacy drain
gate have been proven in the target environment.

| Element                                                                                            | Classification            | Migration decision                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `api/src/services/windows-offline-installer-artifact.service.ts`                                   | `REMOVE`                  | Delete the generic generator; OpenPath generates and stores the artifact.                                                                  |
| `api/src/services/windows-offline-installer-download-refs.service.ts`                              | `MIGRATE_THEN_REMOVE`     | Stop writes, drain/invalidate bounded legacy refs, then remove the runtime service.                                                        |
| `api/src/services/windows-offline-installer-template-cache.service.ts`                             | `REMOVE`                  | OpenPath provisioner/read-only loader owns the template.                                                                                   |
| `api/src/services/windows-offline-installer-audit.service.ts`                                      | `REMOVE`                  | Remove low-level generic generation audit; wrapper canary emits only safe boundary fields.                                                 |
| `api/src/lib/windows-offline-installer-config.ts`                                                  | `REMOVE`                  | Delete CP-owned template/artifact/TTL configuration.                                                                                       |
| `api/src/lib/windows-offline-installer-overlay.ts`                                                 | `REMOVE`                  | OpenPath owns personalization and overlay.                                                                                                 |
| `api/src/lib/windows-offline-installer-ticket-client.ts`                                           | `REMOVE`                  | OpenPath generates the enrollment credential internally.                                                                                   |
| `api/src/lib/windows-offline-installer-route.ts`                                                   | `REMOVE`                  | Delete the CP binary route; proxy the canonical OpenPath route.                                                                            |
| `api/src/lib/windows-offline-installer-readiness.ts`                                               | `REMOVE`                  | Delete local template hashing, sidecar checks, and artifact write probes.                                                                  |
| `api/src/openpath/windows-offline-installer.ts`                                                    | `REMOVE`                  | Remove the CP re-export of generic shared implementation.                                                                                  |
| `api/src/trpc/routers/windows-offline-installer.ts`                                                | `REPLACE_WITH_OPENPATH`   | Keep the public CP wrapper procedure, tenant role/policy, and safe upstream adapter only.                                                  |
| `api/src/lib/openpath/gateway.ts` installer adapter                                                | `KEEP_WRAPPER_SPECIFIC`   | Add the typed public OpenPath HTTP/tRPC call; no internal OpenPath access.                                                                 |
| `api/src/services/windows-offline-installer-integration.service.ts`                                | `KEEP_WRAPPER_SPECIFIC`   | Enforce tenant policy, then delegate the request and teacher token to the public OpenPath adapter.                                         |
| `api/src/lib/gateway-readiness.ts`                                                                 | `REPLACE_WITH_OPENPATH`   | Gate CP readiness on the OpenPath `healthcheck.ready` installer capability check.                                                          |
| `api/src/lib/gateway/application-routes.ts`                                                        | `REPLACE_WITH_OPENPATH`   | Remove the local download handler and explicitly 404 the retired CP path.                                                                  |
| `api/src/lib/gateway/compose-gateway.ts`                                                           | `REPLACE_WITH_OPENPATH`   | Remove the local binary-handler dependency from composition.                                                                               |
| `api/src/lib/openpath-proxy-policy.ts`                                                             | `REPLACE_WITH_OPENPATH`   | Allow only the canonical OpenPath download path through the gateway.                                                                       |
| `api/src/server.ts`                                                                                | `REPLACE_WITH_OPENPATH`   | Remove CP refs/artifact handler construction.                                                                                              |
| gateway request/error/rate-limit/CSRF logging redaction                                            | `KEEP_WRAPPER_SPECIFIC`   | Preserve gateway observability while replacing ref/token-like query values with `REDACTED` in log paths and errors.                        |
| `react-spa/src/components/WindowsOfflineInstallerAction.tsx`                                       | `KEEP_WRAPPER_SPECIFIC`   | Retain visible localized UX and ephemeral href behavior; call the thin CP wrapper.                                                         |
| `react-spa/src/components/__tests__/WindowsOfflineInstallerAction.test.tsx`                        | `REPLACE_WITH_OPENPATH`   | Assert fresh canonical `/api/...` URL per click and no retained href/cache.                                                                |
| `scripts/provision-windows-offline-installer-template.mjs`                                         | `REMOVE`                  | OpenPath provisioner runs in the OpenPath API service.                                                                                     |
| `scripts/lib/windows-offline-installer-template-path.mjs`                                          | `REMOVE`                  | No CP host template directory is resolved or bind-mounted.                                                                                 |
| `scripts/windows-offline-installer-canary.mjs`                                                     | `REPLACE_WITH_OPENPATH`   | Keep only the CP session/policy/gateway -> canonical generate/download boundary canary.                                                    |
| `scripts/resolve-windows-offline-installer-template-pin.mjs`                                       | `KEEP_WRAPPER_SPECIFIC`   | Resolve deployment input from the public OpenPath release sidecar; never provision, hash, or store template bytes in CP.                   |
| `docker/Dockerfile.cp-api` installer env/directories                                               | `REMOVE`                  | Gateway image has no generic installer storage ownership.                                                                                  |
| `docker/docker-compose.yml` gateway template bind mount                                            | `REMOVE`                  | Template is mounted only into the OpenPath API/provisioner.                                                                                |
| `docker/docker-compose.yml` gateway artifact volume                                                | `REMOVE`                  | Personalized artifacts are stored only by OpenPath.                                                                                        |
| `docker/docker-compose.yml` OpenPath API canonical volumes                                         | `REPLACE_WITH_OPENPATH`   | Add canonical template/artifact volumes and one-shot OpenPath provisioner dependency.                                                      |
| `config/.env.example` `CP_OFFLINE_INSTALLER_*`                                                     | `REMOVE`                  | Replace with exact `OPENPATH_WINDOWS_OFFLINE_*` inputs consumed by OpenPath.                                                               |
| `OPENPATH_URL` legacy payload setting                                                              | `REMOVE`                  | Keep only `OPENPATH_API_URL` for gateway transport and `PUBLIC_URL` for public links.                                                      |
| release manifest template pin fields                                                               | `KEEP_WRAPPER_SPECIFIC`   | Retain neutral four-field pin because CP deployment must provide the exact OpenPath template release; export canonical OpenPath env names. |
| release runtime-state template pin fields                                                          | `REPLACE_WITH_OPENPATH`   | Persist the same four values under canonical OpenPath runtime env names.                                                                   |
| deploy host preflight CP provision hook                                                            | `REPLACE_WITH_OPENPATH`   | Validate complete OpenPath pins; provisioning occurs in the Compose OpenPath service.                                                      |
| staging/production deploy phase invoking CP provisioner                                            | `REMOVE`                  | Do not invoke a second provisioner; Compose starts the canonical one-shot service.                                                         |
| `scripts/lib/release-manifest.mjs`, `scripts/lib/release-manifest.sh`                              | `REPLACE_WITH_OPENPATH`   | Preserve neutral release pin metadata while exporting only canonical OpenPath runtime variables.                                           |
| `scripts/lib/release-runtime.sh`, `scripts/lib/release-state*.{mjs,sh}`                            | `REPLACE_WITH_OPENPATH`   | Record and verify the same OpenPath pin tuple for coherent rollback.                                                                       |
| `scripts/lib/release-evidence-snapshot.mjs`                                                        | `REPLACE_WITH_OPENPATH`   | Snapshot canonical OpenPath pin names without recording refs, URLs, tokens, or credentials.                                                |
| `scripts/deploy-staging-remote.sh`, `scripts/deploy-production-remote.sh`                          | `REPLACE_WITH_OPENPATH`   | Wire the canonical provisioner service and OpenPath pin checks; no CP template provisioning.                                               |
| `scripts/lib/deploy-host-preflight.sh`, `scripts/lib/deploy-production-runtime.sh`                 | `REPLACE_WITH_OPENPATH`   | Keep host/runtime orchestration while removing CP-owned template/artifact checks and using canonical OpenPath pins.                        |
| `scripts/verify-production-promotion-ready.sh`                                                     | `REPLACE_WITH_OPENPATH`   | Verify the canonical OpenPath pin tuple and release state.                                                                                 |
| `api/src/db/schema.ts` legacy refs table                                                           | `MIGRATE_THEN_REMOVE`     | Remove the runtime schema after the forward retirement migration is deployed after drain.                                                  |
| `api/drizzle/0010_windows_offline_installer.sql`                                                   | `TEMPORARY_COMPATIBILITY` | Preserve historical migration unchanged; never edit it in place.                                                                           |
| new forward DB migration for `cp_windows_offline_download_refs`                                    | `MIGRATE_THEN_REMOVE`     | Drop the unused legacy table only after the no-new-writes/TTL/no-consumers gate.                                                           |
| `api/scripts/baseline-cp-migrations.ts` retirement filter                                          | `TEMPORARY_COMPATIBILITY` | Keep 0011 out of the baseline ledger until the explicit retirement migration is applied; remove this exception after the table is retired. |
| `api/scripts/migrate-cp.ts`                                                                        | `TEMPORARY_COMPATIBILITY` | Use a filtered normal runner and an explicit one-shot confirmation for destructive 0011; remove the guard after retirement.                |
| `scripts/run-migrations.sh`, `scripts/run-migrations-docker.sh`, `scripts/run-migrations-image.sh` | `TEMPORARY_COMPATIBILITY` | Carry the explicit drain confirmation to the migration process; default deployment never passes it.                                        |
| legacy refs DB data                                                                                | `MIGRATE_THEN_REMOVE`     | Do not migrate raw refs or tokens; let the bounded TTL expire or invalidate them.                                                          |
| API legacy service/route/config/readiness/overlay/ticket tests                                     | `REMOVE`                  | Delete tests for removed ownership and replace with public adapter/readiness/architecture tests.                                           |
| API wrapper/gateway/proxy/readiness tests                                                          | `REPLACE_WITH_OPENPATH`   | Prove tenant policy, forwarded auth, canonical route, and capability signal.                                                               |
| deployment/provisioner tests                                                                       | `REPLACE_WITH_OPENPATH`   | Assert no CP provisioner/mount/volume and canonical OpenPath wiring.                                                                       |
| release pin/state tests                                                                            | `REPLACE_WITH_OPENPATH`   | Assert coherent OpenPath pins and rollback state.                                                                                          |
| historical `docs/superpowers/plans/*windows-offline-installer*`                                    | `REMOVE`                  | Remove obsolete CP-ownership plans after the maintained contract is updated.                                                               |
| `docs/contracts/env.md` Windows section                                                            | `REPLACE_WITH_OPENPATH`   | Document canonical OpenPath inputs and CP readiness consumption.                                                                           |
| `docs/contracts/routes-ports.md`                                                                   | `REPLACE_WITH_OPENPATH`   | Document the canonical root download proxy and retired CP path.                                                                            |

## Sequencing and safety gates

1. Add failing public adapter, tenant-policy, readiness, proxy, frontend, canary,
   deployment, migration-order, and architecture regression tests.
2. Implement the thin OpenPath consumer while legacy code is still present.
3. Update the wrapper canary and deployment wiring; do not run staging or
   production from this change.
4. Update the ClassroomPath submodule gitlink to the minimum compatible OpenPath
   SHA above. Do not edit OpenPath from this repository.
5. Remove generic CP runtime code and its runtime schema declaration, then add
   the forward DB retirement migration. The migration is intentionally not
   executed by local verification. The
   standard migration runner filters `0011_retire_windows_offline_installer_refs`
   until an operator invokes the one-shot
   `--confirm-windows-offline-installer-legacy-retirement` command after the
   deployed drain gate; no runtime feature switch or legacy fallback remains.
6. For an authorized staging cutover, prove login/enrollment UI or API, wrapper
   policy, canonical generate, a 200 attachment, and safe length/hash evidence;
   also prove no new legacy refs/artifacts.
7. Only after the traffic/drain gates are proven may an operator apply the
   destructive DB/storage cleanup. A rollback uses a coherent ClassroomPath /
   OpenPath release pair; no mixed legacy/canonical runtime is supported.

No staging, production deployment, promotion, live canary, issue close, or raw
secret/reference evidence is part of this implementation session.
