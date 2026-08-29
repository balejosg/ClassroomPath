# Windows offline installer legacy retirement

> Status: maintained
> Applies to: ClassroomPath operators retiring the pre-OpenPath installer storage
> Last verified: 2026-08-29
> Source of truth: `docs/runbooks/windows-offline-installer-legacy-retirement.md`

This is a manual, one-shot operation for the old ClassroomPath personalized
installer storage. It is not part of a normal deploy, migration startup, or
Compose teardown.

The supported order is:

```text
canonical ClassroomPath/OpenPath cutover
  -> wait for or invalidate all legacy download references
  -> prove that no legacy runtime can read or write the old storage
  -> apply the deferred DB retirement migration
  -> retire the old personalized-artifact volume
```

Do not copy old `.exe` files, raw references, enrollment tokens, or any other
legacy data into the OpenPath store. The old reference table and old artifact
volume have independent destructive operations so that each drain gate is
auditable.

## Preconditions

Before running the storage helper, the operator must have evidence for the
canonical deployment and all of the following:

- new generations no longer write the legacy reference table or artifact
  volume;
- every legacy reference has expired under its existing TTL or has been
  invalidated;
- no deployed legacy runtime still serves or mounts the old volume;
- the deferred `0011_retire_windows_offline_installer_refs` migration has been
  applied with the explicit legacy-retirement confirmation.

The helper also requires the effective Compose project name. It never guesses a
project from a volume name and never uses a name-only prefix match.

The DB migration confirmation and the physical storage confirmation are separate
authorizations. The migration environment variable
`CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED=1` is scoped to the
deferred DB migration only; it never authorizes this helper and must not be used
as a persistent runtime setting.

## Explicit command

Set `COMPOSE_PROJECT_NAME` to the project name used by the running stack and
pass the same value explicitly with the required `--project-name` argument:

```sh
COMPOSE_PROJECT_NAME=<effective-project-name> \
  npm run ops:retire-windows-offline-installer-legacy-storage -- \
  --project-name <effective-project-name> \
  --confirm-windows-offline-installer-legacy-retirement
```

The command fails closed unless the confirmation flag is present in that exact
invocation. The DB migration environment variable is ignored by this storage
helper, even when it is set to `1`. It first looks up the exact old Compose
volume using both labels:

```text
com.docker.compose.project=<effective-project-name>
com.docker.compose.volume=windows-offline-installer-artifacts
```

It then requires `docker volume inspect` to report all of the following:

- exact name `<effective-project-name>_windows-offline-installer-artifacts`;
- driver `local`;
- the same two expected label values.

The standard Compose metadata labels `com.docker.compose.config-hash` and
`com.docker.compose.version` may also be present. Any other label, or a missing
or empty known label, is unexpected and fails closed.

Only after both label lookup and inspection agree does it execute
`docker volume rm` for that exact old name. A missing volume is a successful
no-op. Missing/unexpected labels, multiple candidates, name-like candidates,
and the canonical `windows_offline_installer_artifacts` volume all fail
without removal.

Never substitute `docker compose down -v`, `docker volume prune`, a wildcard,
or a project-wide volume deletion command.

## Rollback boundary

Applying `0011_retire_windows_offline_installer_refs` and removing the legacy
artifact volume are the point of no return for the pre-OpenPath installer
lifecycle. Neither operation is part of a normal deploy or automatic rollback.
Automatic rollback accepts only release state with the complete OpenPath
installer pin and restores that pin before starting the provisioner/API pair;
it refuses an older state that cannot prove canonical compatibility. Once the
DB drain and storage retirement are complete, restore a compatible OpenPath
release manually if required; do not roll back to a release that expects the
old table or volume.
