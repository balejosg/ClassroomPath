# ClassroomPath #158 runtime rollback contract

## Scope

Close the remaining #158 findings in ClassroomPath without changing the
OpenPath submodule or introducing a second installer owner. The existing
release manifest and release-state formats remain the source of truth.

## Design

`OPENPATH_LINUX_AGENT_APT_SUITE` becomes a required member of the release
candidate runtime tuple alongside `OPENPATH_VERSION` and
`OPENPATH_LINUX_AGENT_VERSION`. The value is propagated from the manifest into
deploy runtime configuration and the typed `current-runtime` snapshot. The
existing previous-state copy therefore preserves the same tuple for rollback.

Rollback validates snapshot field presence before sourcing or using it. A
runtime snapshot without the Linux agent version or APT suite is incompatible
and fails closed before checkout, reset, submodule update, `.env` mutation,
Docker operations, or release-state activation. No value is inferred from the
host environment, `config/.env`, or a default suite. Production accepts only
`release-candidate`; `source-build` is rejected by the same pre-mutation
preflight. Staging retains its existing `source-build` recovery path.

The staging verification contract carries the APT suite as well, so staging
and production compare the same Linux runtime tuple before promotion.

The Windows template pin step reads both `VERSION` and the abbreviated commit
from `OPENPATH_TEMPLATE_COMMIT`. The release tag is derived only from those
values, ensuring that a newer checkout `HEAD` cannot be combined with an older
published promotion contract.

## Verification

Tests cover current/previous snapshot persistence, production restoration of
version plus suite, stale-host rejection, incomplete-snapshot rejection before
all mutations, staging/production contract parity, production source-build
rejection, and the Windows `HEAD VERSION != promotion commit VERSION`
regression. Existing migration-confirmation, readiness, storage, public URL,
and installer ownership contracts remain covered by their current suites.
