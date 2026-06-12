# ClassroomPath AGENTS.md

> Status: maintained
> Applies to: agent workflow inside the ClassroomPath repository
> Last verified: 2026-05-18
> Source of truth: `AGENTS.md`

ClassroomPath is the source-available managed service layer built on OpenPath. Keep public repo work
focused on transparency, auditability, security review, interoperability assessment, and local
private evaluation.

## Public Repository Posture

- ClassroomPath is source-available, not open source.
- OpenPath is the OSS core and primary community contribution target.
- Do not publish live deployment targets, staging hosts, internal IPs, private filesystem paths,
  provider secrets, runner hostnames, VM identifiers, billing setup details, or production runbooks.
- Do not run staging deploys, production deploys, live smoke tests, billing calls, release/tag
  commands, DNS changes, or external service calls unless the user explicitly requests that
  operational work in a private context.

## Trunk-Based Workflow

`main` is the only allowed working branch. (canonical: root AGENTS.md "Workspace Rules > Trunk-Based Only")

- Do not create feature branches, PR branches, or integration branches.
- Do not commit from detached HEAD.
- Never push from the workspace root. (canonical: root AGENTS.md "Workspace Rules > Root Pushes Are Forbidden")
- Push only from `ClassroomPath/` when explicitly asked.

## Verification

For public-surface or documentation changes, prefer local checks:

- `npm run verify:public-surface`
- `npm run verify:docs`
- `npm run format:check`
- `npm run verify:commit`

Do not use deploy workflows, live staging/production checks, or provider APIs as the first signal for
ordinary code or documentation work.

### Script Semantics

**Warning: script names in ClassroomPath do NOT mean the same as in OpenPath. Never assume cross-repo symmetry.**

| Script                        | What it actually runs                                                                                                                                  | When to use                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `verify:precommit`            | lint-staged (staged files only)                                                                                                                        | runs automatically via pre-commit hook                                                       |
| `verify:commit`               | verify:public-surface + VERIFY_MODE=commit verify-full.sh -- includes tests                                                                            | standard pre-commit manual check for code changes                                            |
| `verify:fast`                 | VERIFY_MODE=fast bash scripts/verify-full.sh -- **runs tests** (reduced e2e depth)                                                                     | fastest full-suite pass; first manual lane for most changes                                  |
| `verify:release`              | VERIFY_MODE=release bash scripts/verify-full.sh -- full suite, no cache shortcuts                                                                      | pre-tag gate; use when preparing a release                                                   |
| `verify:full`                 | alias of verify:release (VERIFY_MODE=release)                                                                                                          | same as verify:release                                                                       |
| `verify:public-surface`       | node scripts/check-public-surface.mjs -- scans all tracked files for private hostnames, internal IPs, secrets                                          | after any content change before push                                                         |
| `verify:docs`                 | node scripts/verify-docs.mjs -- dead links, non-ASCII, docs/ structure                                                                                 | after editing any markdown doc                                                               |
| `verify:promotion-ready`      | bash scripts/verify-production-promotion-ready.sh -- checks staging is promotion-eligible                                                              | before initiating a production promotion                                                     |
| `test:ci-regression`          | runCiRegression + runWorkflowConfigRegression from run-ci-regression.mjs                                                                               | after editing CI workflow files                                                              |
| `test:deployment`             | node tests/deployment-foundation.test.ts, deployment-staging-release.test.ts, deployment-runtime-contracts.test.ts                                     | after editing deploy scripts or Docker config                                                |
| `test:windows-bootstrap-gate` | node tests/windows-bootstrap-gate.test.ts                                                                                                              | after editing Windows bootstrap or enrollment scripts                                        |
| `db:test:reset`               | docker compose down -v + up postgres for the test project -- **destroys local test DB containers**                                                     | reset a corrupted or leftover test database; data loss is expected                           |
| `release:preflight`           | node scripts/release-preflight.mjs -- read-only pass/block report for the next release                                                                 | before cutting a release tag                                                                 |
| `release:status`              | node scripts/release-status.mjs -- read-only local promotion status                                                                                    | inspect current release/submodule state                                                      |
| `release:evidence-bundle`     | node scripts/release-evidence-bundle.mjs -- assembles verifiable evidence from artifacts                                                               | after a staging deploy, before production promotion                                          |
| `promote:production`          | bash scripts/tag-production-release.sh **requires explicit version tag argument** -- tags origin/main after staging promotion check                    | production promotion: requires `<tag>` argument, e.g. `npm run promote:production -- v1.2.x` |
| `promote:production:full`     | node scripts/release-promote.mjs --auto-tag -- full orchestrated sequence (evidence validation, deploy, health check, canary); **auto-determines tag** | fully automated production promotion; no version argument needed                             |

## Architecture Boundary

Read these first for wrapper work:

- `../agent-manifest.json`
- `react-spa/vite.config.ts`
- `react-spa/src/ClassroomPathApp.tsx`
- `react-spa/src/ClassroomPathShell.tsx`
- `../OpenPath/docs/adr/0010-public-spa-extension-surface.md`

Rules:

- consume OpenPath SPA functionality through public entrypoints only
- do not deep-import upstream OpenPath SPA internals during ordinary ClassroomPath wrapper work
- OpenPath must remain agnostic of ClassroomPath
- do not edit files inside `upstream/openpath/` directly for ClassroomPath-only changes

## Private Deployment Targets

Committed deploy target files use `.invalid` placeholders. Maintainers who need private deploy
operations should create `config/deploy-targets.local.json` from
`config/deploy-targets.example.json` or set `CLASSROOMPATH_DEPLOY_TARGETS_FILE` to a private config
path. Real targets must stay untracked.

## Common Mistakes To Avoid

- treating ClassroomPath as the OpenPath community support repo
- committing `.env`, `.env.local`, or `config/deploy-targets.local.json`
- documenting live hostnames, LAN addresses, SSH users, key filenames, VM identifiers, or provider
  setup commands
- claiming production resolution from local or staging-only evidence

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<identifiers>" --graph graphify-out/graph.json` (from this repo's root) when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Query with code identifiers (function/file/symbol names), not prose questions -- start-node matching is literal substring matching on node labels. If results look irrelevant, grep graph.json node labels for your term first, then re-query with the labels you find.
- Always pass `--graph` explicitly; the default depends on the current working directory.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- The graph rebuilds automatically via the post-commit hook (background, log: `~/.cache/graphify-rebuild.log`). Manual refresh: `graphify update .` from this repo's root. `.graphifyignore` excludes `upstream/` -- the vendored OpenPath core is covered by its own graph at the workspace root.
