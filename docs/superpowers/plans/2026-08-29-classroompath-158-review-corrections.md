# ClassroomPath #158 review corrections — implementation plan

## Goal

Correct the local ClassroomPath implementation at `a602f9a` without changing
`upstream/openpath/`. ClassroomPath remains the wrapper, tenant-policy, gateway,
and UX boundary; the pinned OpenPath submodule remains the only generic Windows
offline-installer lifecycle owner.

## Constraints and acceptance evidence

- Preserve the pinned OpenPath submodule at
  `fe253a94053eafc5356b7a6c6c24b109df599d15`.
- Keep the API and provisioner non-root and prepare both mounted roots in the
  ClassroomPath image before `USER node`.
- Prove named-volume initialization with a real Docker smoke when a local daemon
  is available; otherwise retain deterministic contract tests and report the
  dynamic probe as unverified.
- Retire only the old Compose volume after the DB/ref drain gate, using explicit
  Compose labels plus the operator-supplied project name and an exact volume key.
  The normal deploy path must never invoke this one-shot helper.
- Rebuild the public download URL from the configured ClassroomPath origin with
  `URL`/`URLSearchParams`, preserving the opaque ref value and never returning an
  upstream/internal origin.
- Preserve the canonical OpenPath generate/download lifecycle, wrapper policy,
  readiness behavior, retired `/cp/api/...` route, and secret/ref redaction.

## Execution steps

1. Add red tests for same-origin URL reconstruction/ref serialization, Docker
   root setup and Compose mounts, and the retirement helper's confirmation,
   exact-label resolution, idempotence, and canonical-volume exclusion.
2. Implement the smallest adapter change: validate OpenPath metadata, extract
   only its opaque `ref`, and construct the same-origin canonical URL from the
   gateway's public origin.
3. Update `docker/Dockerfile.api` to create, own, and mode the canonical template
   and artifact roots before `USER node`. Add a standalone fresh-volume smoke
   that builds this image, mounts unique named volumes, exercises both runtime
   users, verifies the read-only template mount and private artifact mount, and
   removes only its own temporary resources.
4. Add an explicit one-shot legacy-storage retirement module and CLI. Resolve
   the effective volume through exact project/key labels and exact expected name;
   fail closed on missing/mismatched/ambiguous identity; remove only that exact
   volume. Add the operator runbook and keep migration `0011` deferred as-is.
5. Update deployment/runtime contract tests and docs to cover the helper, its
   ordering, and the absence of legacy deploy wiring. Do not add a deploy hook,
   fallback, dual-write, or OpenPath internal import.
6. Run focused API/deployment/retirement tests, the fresh-volume smoke if
   Docker is available, then the repository's required local verification lane.
   Inspect the final diff, submodule status, and secret/ref safety before handoff.

## Verification commands

```sh
npm exec prettier -- --check <changed-files>
npm exec tsx --test api/tests/lib/openpath/windows-offline-installer.test.ts
npm exec tsx --test tests/windows-offline-installer-legacy-retirement.test.ts
npm run test:deployment
npm run verify:docs
npm run verify:public-surface
npm run verify:scripts-types
npm run verify:incremental
node scripts/windows-offline-installer-volume-smoke.mjs
```

The Docker command is conditional on a healthy local Docker daemon. Staging,
production, release, tag, push, and remote destructive operations are outside
this implementation and will not be run.
