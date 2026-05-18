# Publication Readiness

> Status: maintained
> Applies to: public ClassroomPath repository readiness
> Source of truth: `docs/PUBLICATION-READINESS.md`

ClassroomPath is public for transparency, auditability, security review, interoperability
assessment, and local private evaluation. It is intentionally low-profile and remains
source-available, not open source.

## Sanitized Public Surface

- README positioning now points community and OSS-core work to OpenPath.
- Security reporting is routed through private vulnerability reporting instead of public issues.
- Operational runbooks are public stubs rather than live staging, production, runner, or billing
  procedures.
- Committed deploy targets use `.invalid` placeholders.
- Real deploy targets belong in `config/deploy-targets.local.json` or a private file referenced by
  `CLASSROOMPATH_DEPLOY_TARGETS_FILE`.
- Environment examples use blank secrets and placeholder domains only.
- `npm run verify:public-surface` scans tracked files for common public-surface leaks.

## Private Operational Docs

Keep these outside the public repository:

- live staging and production hostnames, health endpoints, smoke URLs, and canary URLs
- SSH users, key filenames, private filesystem paths, and deployment target details
- billing provider setup, webhook endpoints, catalog identifiers, and secret inventories
- runner hostnames, VM identifiers, snapshots, lab machine names, and recovery procedures
- backup, rollback, production promotion, incident response, and operator runbooks

## Private Deploy Targets

```bash
cp config/deploy-targets.example.json config/deploy-targets.local.json
```

Edit `config/deploy-targets.local.json` with private values. The file is gitignored. Deployment and
live smoke commands fail closed when only committed `.invalid` placeholder targets are available.

For one-off private automation, set `CLASSROOMPATH_DEPLOY_TARGETS_FILE` to a private config path.

## Manual Follow-Up

Current-file cleanup does not purge historical or external exposure. Separately review public
issues, workflow logs and artifacts, releases, packages, screenshots, repository history, and any
mirrors or forks.

Rotate any secret that may ever have been committed or exposed. Review or rotate deployment keys,
provider keys, webhook secrets, OAuth credentials, VAPID keys, JWT secrets, database URLs, and
tokens if exposure is uncertain.

Enable or verify GitHub private vulnerability reporting and secret scanning where available. If the
low-profile requirements become incompatible with a public source-available repository, decide
whether ClassroomPath should ultimately become private.
