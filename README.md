# ClassroomPath

ClassroomPath is the source-available managed service layer built on top of
[OpenPath](https://github.com/balejosg/openpath). It adds tenant, organization, onboarding, and
managed-service workflows around the OpenPath core while keeping OpenPath as the public
open-source/community project.

This repository is public for transparency, auditability, security review, interoperability
assessment, and local private evaluation. It is intentionally low-profile and is not the main
community contribution hub. Community feedback and OSS-core contributions should go primarily to
OpenPath.

![ClassroomPath onboarding overview](docs/evaluation/assets/onboarding-overview.png)

## What ClassroomPath Adds

- Organization-scoped onboarding, invitations, and approval flows
- Tenant-specific user, classroom, and group management
- Cross-system orchestration for mutations that span ClassroomPath and OpenPath
- A bounded wrapper over the OpenPath React SPA public surface
- Managed-service policy and evaluation documentation for review

## OpenPath Relationship

| Project         | Role                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `OpenPath`      | Open-source core for endpoint enforcement, policy data, browser integration, and shared UI pieces |
| `ClassroomPath` | Source-available managed service layer that consumes OpenPath and adds SaaS-specific workflows    |

OpenPath remains separately licensed under its own license. ClassroomPath must not add dependencies
from OpenPath back into ClassroomPath.

## License Boundary

ClassroomPath is distributed under the ClassroomPath Source-Available License 1.0. It is
source-available, not open source.

Permitted uses include review, audit, interoperability assessment, security research, private
modification, and local non-production evaluation.

Without prior written permission, the license does not permit production use, institutional
self-hosting, SaaS resale, redistribution, white-label operation, hosted replicas, or operating the
service for real classrooms, tenants, organizations, customers, or third parties.

See [`LICENSE`](LICENSE) for the full terms.

## Public Evaluation Docs

- Documentation index: [`docs/INDEX.md`](docs/INDEX.md)
- Security policy: [`SECURITY.md`](SECURITY.md)
- Security and trust overview: [`docs/evaluation/security-trust.md`](docs/evaluation/security-trust.md)
- Claims and evidence map: [`docs/evaluation/claims-and-evidence.md`](docs/evaluation/claims-and-evidence.md)
- Compatibility matrix: [`docs/evaluation/compatibility-matrix.md`](docs/evaluation/compatibility-matrix.md)
- IT evaluation checklist: [`docs/evaluation/it-evaluation-checklist.md`](docs/evaluation/it-evaluation-checklist.md)
- OpenPath vs. ClassroomPath: [`docs/evaluation/openpath-vs-classroompath.md`](docs/evaluation/openpath-vs-classroompath.md)

## Local Private Evaluation

1. Clone with submodules.

```bash
git clone --recurse-submodules https://github.com/balejosg/ClassroomPath.git
cd ClassroomPath
```

2. Install workspace dependencies.

```bash
npm run install:all
```

3. Create local configuration files from examples.

```bash
cp config/.env.example config/.env
cp .env.local.example .env.local
cp config/deploy-targets.example.json config/deploy-targets.local.json
```

4. Fill local-only values with private placeholders or test secrets. Do not commit `config/.env`,
   `.env.local`, or `config/deploy-targets.local.json`.

5. Build and run the local stack.

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

The committed deploy target files use `.invalid` placeholders. Deployment-oriented commands fail
closed until a private deploy target file is provided locally or through
`CLASSROOMPATH_DEPLOY_TARGETS_FILE`.

## Verification

Useful local checks for repository changes:

```bash
npm run verify:public-surface
npm run verify:docs
npm run format:check
```

Deployment, staging, production, billing-provider setup, and live smoke workflows are operational
procedures maintained outside the public repository.
