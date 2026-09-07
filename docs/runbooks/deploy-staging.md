# Public Note: Staging Deployment

> Status: public stub
> Applies to: ClassroomPath public repository surface
> Source of truth: `docs/runbooks/deploy-staging.md`

ClassroomPath staging deployment runbooks are operational material and are maintained privately.
They may include environment targets, SSH access details, release-state paths, smoke URLs, and
operator procedures that do not belong in the public source-available repository.

For local private evaluation, copy `config/deploy-targets.example.json` to
`config/deploy-targets.local.json` and use placeholder or private non-production values. The
committed deploy targets intentionally use `.invalid` hosts and deployment commands fail closed until
private targets are supplied.

Public reviewers can use the evaluation and contract docs linked from `docs/INDEX.md` to assess the
architecture without access to live staging procedures.

## Exact RC staging path

The promotion path accepts an explicit successful release-candidate run and carries its immutable
identity through staging:

```sh
npm run deploy:staging -- --rc-run-id <RC_RUN_ID>
```

The RC-first `release:promote` orchestrator uses this adapter before production readiness. The
adapter must not replace the requested run with `origin/main`, a newer run, or a latest artifact.
