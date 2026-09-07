# ClassroomPath #167 Release Operations Design

**Status:** Approved for implementation by the requester on 2026-09-07.

**Scope:** Local implementation and contractual verification only. This work must not deploy staging or production, create or push tags, create releases, dispatch or rerun remote workflows, or modify `OpenPath/` or `ClassroomPath/upstream/openpath/`.

## Goal

Make the release path fail closed around one explicit immutable release candidate, prove that candidate in staging before production promotion, share the hermetic deployment executor between staging and production, and append safe terminal facts to a durable deployment ledger.

## Non-goals

- No blue/green deployment, Kubernetes, GitOps migration, or new global state machine.
- No automatic rollback candidate selection.
- No rebuild during promotion and no `latest`, branch, ancestor, previous-tag, or current-staging identity fallback in the canonical path.
- No change to the OpenPath repository or to the imported `upstream/openpath/` checkout.
- No operational execution as part of implementation.

## Immutable promotion identity

The canonical input is an explicit successful release-candidate workflow run:

```text
--rc-run-id <RC_RUN_ID>
```

The exact resolver must derive and retain this identity before any promotion state is written:

```text
I = {
  RC_RUN_ID,
  C,                    # ClassroomPath source SHA
  RELEASE_ID,
  OPENPATH_SHA,
  CONTRACT_SHA256,
  bundle digest/bytes,
  OCI image digests,
  Windows evidence tuple
}
```

The pre-tag resume directory is keyed by the explicit RC run, for example:

```text
.opencode/tmp/release-promote/rc-34124312483/
```

Its first identity record contains the complete immutable `I` plus the proposed tag, if one has already been calculated. `--resume` fails closed if any identity member changes. The proposed tag is metadata until the annotated tag is created; it is never the authority for pre-tag state.

Once a tag exists, the canonical tag message records the irreversible association:

```text
tag -> RC_RUN_ID + C + RELEASE_ID + OPENPATH_SHA + CONTRACT_SHA256
```

The existing exact annotated-tag reconciliation and canonical tag schema remain authoritative. Existing, conflicting, lightweight, moved, or identity-incomplete tags fail closed.

## Canonical promotion sequence

`release:promote` becomes an orchestrator. Its exact sequence is:

```text
explicit RC_RUN_ID
  -> exact RC resolver (C / releaseId / bundle / contract / images)
  -> exact staging deployment through the shared executor
  -> exact staging verification
  -> production readiness (R / config / host / artifacts)
  -> human and machine summary (C / RC / releaseId / R / proposed tag)
  -> approval boundary
  -> one annotated tag and push, only in explicit execute mode
  -> existing tag-only production workflow
```

The default remains read-only/dry-run. `--execute` is the only mode allowed to cross the tag/push boundary, and implementation verification will not invoke it. The tag may be supplied explicitly or proposed by the existing patch-tag policy, but the proposed tag cannot select the RC or drive resume identity.

The canonical command requires `--rc-run-id`; it does not resolve `origin/main`, latest, or current staging as a substitute. `promote-current-staging` remains a deprecated compatibility wrapper. It may read only the current staging RC run ID and delegate to `release:promote --rc-run-id <exact>`. It must not calculate identity, implement readiness, own tag schema, or push a tag independently.

## Readiness and recovery authority

Production readiness is exposed as a read-only operation that accepts the exact RC identity and produces both human-readable blockers and stable JSON. It reuses the existing exact bundle resolver, staging evidence parser/contract, Windows evidence validator, release-state checks, production target preflight, and recovery authority/preflight primitives.

Required blocker classes are:

```text
RC_BLOCKER
STAGING_BLOCKER
CONFIG_BLOCKER
RECOVERY_BLOCKER
HOST_BLOCKER
ARTIFACT_BLOCKER
```

Readiness must validate:

- the explicit RC run is successful and uniquely resolves to one exact bundle;
- `C`, RC run, release ID, OpenPath SHA, contract bytes/hash, OCI digests, and Windows tuple agree;
- staging is running and verified for that exact identity;
- an explicit full lowercase `PRODUCTION_RECOVERY_SHA=R` exists, `R != C`, and its source checkout, versions, contract, artifact, and executor are exact and preflighted through the existing recovery code;
- required production configuration and secret names are present without exposing values;
- the production host contract, SSH/Docker/Compose/filesystem and safe artifact pullability are ready without mutation.

The readiness operation and the tag-only production workflow call the same recovery-authority operation. The workflow may revalidate after the tag, but it must not maintain a separate approximation of recovery validation. Host-contract checks should use the same shared primitive where the current host adapter permits it.

Any failed pre-tag readiness check prevents tag creation and production mutation.

## Shared deployment runtime

The code is split at these boundaries:

```text
release-promote
  = selection + ordering + UX + approval + tag + monitoring

staging adapter       production adapter
        \                 /
         canonical hermetic deploy runtime
```

The canonical runtime owns:

- immutable bundle and release identity validation;
- runtime projection from the exact release bundle;
- transaction ownership and phase transitions;
- image/artifact preparation and switch semantics;
- semantic health and readiness checks;
- live identity and commit validation;
- commit/publish semantics;
- recovery/rollback result recording;
- terminal ledger append.

Adapters own only environment-specific identity and policy: host, URLs, deploy root, Compose project, credentials, `production=true/false`, and fault/recovery scope. They must not duplicate runtime projection, state transitions, health/ready semantics, live identity validation, or commit logic. The staging adapter must retain the strict staging fence and `classroompath-staging`; production must retain the production fence and its K-only fault barrier.

Normal staging success uses the existing transaction vocabulary:

```text
PREPARED -> SWITCHING -> ACTIVATED_UNVERIFIED -> VERIFIED -> COMMITTED
```

The existing rollback semantics remain stable-candidate-based and fail closed. A forward leg remains failed even when rollback succeeds.

## Deployment ledger

The executor/infra layer, never the application, appends one safe JSON object per terminal deployment result to:

```text
release-state/deployment-ledger.jsonl
```

Each line is append-only and contains only an allowlisted bounded schema, including as available:

```json
{
  "timestamp": "...",
  "environment": "production",
  "tag": "v1.2.380",
  "transactionId": "...",
  "candidateSha": "...",
  "rcRunId": "...",
  "releaseId": "...",
  "openPathSha": "...",
  "contractSha256": "...",
  "recoverySha": "...",
  "phase": "COMMITTED",
  "result": "COMMITTED",
  "previous": "...",
  "current": "...",
  "imageDigests": {},
  "health": 200,
  "ready": true,
  "rollback": { "attempted": false, "result": "NOT_REQUIRED" },
  "workflowRunId": "..."
}
```

The exact field names may follow established repository conventions, but values must remain bounded and safe. No secrets, tokens, credentials, private keys, full environment dumps, personalized payloads, or arbitrary command output may be written. A rollback appends a new terminal fact such as `result=ROLLED_BACK`, `current=P`, `candidate=C`; it never rewrites the prior entry.

Ledger append uses the existing transaction/ownership lock model. It must serialize concurrent writers, use atomic append/flush semantics, preserve unrelated identity, and reject a duplicate transaction with different identity rather than overwriting. The ledger remains bounded by truncating/normalizing only through an explicit safe retention policy; implementation must not silently delete historical terminal facts.

## Compatibility and workflow boundaries

- `release:promote` is the only canonical promotion entrypoint.
- `promote-current-staging` is a compatibility shim that resolves the exact staging RC run ID and delegates.
- Deprecated production promotion aliases remain non-operational.
- Production remains tag-only: the post-tag workflow consumes the exact tag identity and revalidates readiness.
- Existing smoke-test jobs remain independently observable; no dependency on an unrelated health job may hide failures.
- No implementation command may deploy, create/push tags, create releases, or dispatch remote workflows.

## Verification contract

Tests must cover at minimum:

- exact RC resolution: valid, missing, failed, ambiguous, and identity mismatch;
- exact staging proof and rejection of a different staging RC/recovery identity;
- recovery `R` missing, malformed, equal to `C`, wrong source/artifact/executor/contract;
- missing configuration, host, or pullability blockers without secret leakage;
- pre-tag failure with no tag/mutation;
- promotion order, one-tag rule, collision, resume identity mismatch, no rebuild/latest fallback;
- wrapper delegation and absence of duplicated authority;
- shared executor convergence, environment fence, and common state/health/commit behavior;
- ledger success, failure, rollback, pre-boundary failure, serialisation, duplicate identity rejection, bounded safe fields, no secrets, and no overwrite;
- tag-only workflow identity, recovery revalidation, and independent smoke-test execution.

Local verification must use the cheapest relevant lanes first, then the repository's incremental verification and targeted deployment/workflow suites. Operational proof remains separate and is not claimed by local tests.
