# ClassroomPath

> Status: maintained
> Applies to: product overview, local development, and release workflow
> Last verified: 2026-04-13
> Source of truth: `README.md`

ClassroomPath is the multi-tenant SaaS wrapper around [OpenPath](https://github.com/balejosg/openpath).
It adds organization-aware onboarding, delegated administration, deployment workflows, and operational
contracts on top of the OpenPath OSS core.

> WARNING: ClassroomPath is distributed under the ClassroomPath Source-Available License 1.0.
> The source is published for transparency, auditability, and private modification, but the license does not permit reproducing the service.
> No production use, self-hosting, redistribution, white-labeling, or hosted replicas are allowed without written permission.
> Deploy and operate this software only in systems and networks where you have explicit authorization.

## Documentation

- Canonical documentation index: [`docs/INDEX.md`](docs/INDEX.md)
- Agent workflow and environment routing: [`AGENTS.md`](AGENTS.md)
- Staging deploy runbook: [`docs/runbooks/deploy-staging.md`](docs/runbooks/deploy-staging.md)
- Production deploy runbook: [`docs/runbooks/deploy-production.md`](docs/runbooks/deploy-production.md)

## What ClassroomPath Adds

- Organization-scoped onboarding, invitations, and approval flows
- Tenant-specific user, classroom, and group management
- Durable cross-system orchestration for mutations that span ClassroomPath and upstream OpenPath
- A release workflow that promotes `main` to staging first and production by `v*` tags only
- A bounded wrapper over the OpenPath React SPA public surface

## OpenPath vs. ClassroomPath

| Product         | Role                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `OpenPath`      | OSS core for endpoint enforcement, policy data, browser integration, and the shared UI foundation                 |
| `ClassroomPath` | SaaS wrapper that adds tenancy, billing/onboarding policy, deploy automation, and environment-specific operations |

## Live URLs

Machine-readable source of truth: [`config/deploy-targets.json`](config/deploy-targets.json)

| Environment    | URL                                       | Deploy Trigger           |
| -------------- | ----------------------------------------- | ------------------------ |
| **Production** | https://classroompath.eu                  | Git tag `v*`             |
| **Staging**    | https://classroompath-staging.duckdns.org | `npm run deploy:staging` |

## Architecture

Runtime shape:

- `gateway` is the public entrypoint and owns `/cp/*`
- OpenPath API stays internal to the Docker network and is exposed through controlled gateway passthroughs
- the public hostnames and health endpoints are centralized in `config/deploy-targets.json`
- ClassroomPath wraps the OpenPath React SPA through the documented public surface, not deep imports into upstream internals

## Multi-Tenancy

ClassroomPath persists tenancy and orchestration data in `cp_*` tables while continuing to rely on
OpenPath for upstream policy entities and endpoint-facing behavior. The canonical details live in:

- [`docs/contracts/cross-system-mutations.md`](docs/contracts/cross-system-mutations.md)
- [`docs/contracts/routes-ports.md`](docs/contracts/routes-ports.md)
- [`docs/SESSION_SECURITY_MODEL.md`](docs/SESSION_SECURITY_MODEL.md)

## Quick Start (Development)

1. Clone with submodules.

```bash
git clone --recurse-submodules https://github.com/balejosg/ClassroomPath.git
cd ClassroomPath
```

2. Install workspace dependencies.

```bash
npm run install:all
```

3. Create local config files from examples.

```bash
cp config/.env.example config/.env
cp .env.local.example .env.local
# Edit config/.env with your values
# Edit .env.local only if you will use the staging deploy workflow
```

4. Build and run the local stack.

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

## Verification

Normal git workflow:

- `.husky/pre-commit` runs `npm run verify:commit`
- `.husky/pre-push` enforces trunk policy only
- use manual verification commands when you need targeted confidence outside the hook flow

Manual lanes:

```bash
npm run test:deployment
npm run test:e2e:full
npm run test:e2e:mobile
npm run verify:release
```

## Deployment

Staging promotion:

```bash
git push origin main
npm run deploy:staging
```

Production promotion:

```bash
git tag v1.0.1
git push origin v1.0.1
```

Use the maintained runbooks for the full workflow:

- [`docs/runbooks/deploy-staging.md`](docs/runbooks/deploy-staging.md)
- [`docs/runbooks/deploy-production.md`](docs/runbooks/deploy-production.md)
- [`docs/runbooks/update-openpath-submodule.md`](docs/runbooks/update-openpath-submodule.md)
- [`docs/runbooks/configure-stripe-billing.md`](docs/runbooks/configure-stripe-billing.md)

## Updating OpenPath

```bash
npm run submodule:update
git add upstream/openpath
git commit -m "chore: update openpath submodule"
git push origin main
npm run deploy:staging
```

## License

ClassroomPath Source-Available License 1.0.

See `LICENSE` for full terms, including:

- source access for review, audit, and private modification,
- local private development and test use only,
- no production use or self-hosting,
- no redistribution, white-labeling, SaaS resale, or hosted replicas, and
- separate licensing for `OpenPath`, which remains under `AGPL-3.0-or-later`.
