# ClassroomPath AGENTS.md

> Status: maintained
> Applies to: agent workflow inside the ClassroomPath repository
> Last verified: 2026-05-18
> Source of truth: `AGENTS.md`

ClassroomPath is the source-available managed service layer built on OpenPath. Keep public repo work
focused on transparency, auditability, security review, interoperability assessment, and local
private evaluation.

## Workflow Proportionality

Use direct work for bounded changes; delegate only when isolation, specialist work
or independent judgment adds value. Keep one writer. Use skills when explicitly
requested or clearly applicable; generic workflow guidelines do not require extra
design documents, commits or repeat approval for an already-approved narrow change.
Use fuller design work when requirements, architecture or material risks remain
unresolved. Read applicable instructions fully when required and reuse unchanged
context. None of this waives safety checks, required review or final acceptance.

## Public Repository Posture

- ClassroomPath is source-available, not open source.
- OpenPath is the OSS core and primary community contribution target.
- Do not publish live deployment targets, staging hosts, internal IPs, private filesystem paths,
  provider secrets, runner hostnames, VM identifiers, billing setup details, or production runbooks.
- Do not run staging deploys, production deploys, live smoke tests, billing calls, release/tag
  commands, DNS changes, or external service calls unless the user explicitly requests that
  operational work in a private context.

## Trunk-Based Workflow

`main` is the only allowed branch for writes/commits; detached checkouts are read-only. (canonical: root AGENTS.md "Workspace Rules > Trunk-Based Only")

- Do not create feature branches, PR branches, or integration branches.
- Do not commit or push from detached HEAD; isolate concurrent writers on `main`.
- Never stash, discard changes or switch a user's checkout automatically; preserve unexpected state and resolve ownership/authority first.
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

**Warning: script names in ClassroomPath do NOT mean the same as in OpenPath. Never assume cross-repo symmetry.** Script bodies live in `package.json`: read them there. This list records only what a script name does not tell you.

Verify:

- `verify:fast` (alias `verify:incremental`): `VERIFY_MODE=fast bash scripts/verify-full.sh` -- **runs tests**, with reduced e2e depth. Fastest full-suite pass; first manual lane for most changes.
- `verify:commit`: `verify:public-surface` plus the `VERIFY_MODE=commit` suite, tests included. Standard manual check before committing code changes.
- `verify:release` (alias `verify:full`): `VERIFY_MODE=release`, full suite with no cache shortcuts. Pre-tag gate.
- `verify:precommit`: lint-staged on staged files; runs automatically via the pre-commit hook.
- `verify:static`: turbo typecheck + lint for the api, contracts, presenters, react-spa and testkit workspaces; no tests, no build.
- `verify:public-surface`: scans all tracked files for private hostnames, internal IPs and secrets. Run after any content change, before push.
- `verify:docs`: dead links, non-ASCII, `docs/` structure. Run after editing any markdown doc.
- `verify:promotion-ready`: checks staging is promotion-eligible; exit 0 ready, 10 blocked (expected steady state), 1+ genuine gate error.

Test and build:

- `test`: runs the **OpenPath** unit tests through `scripts/run-openpath.sh`; it does NOT run `tests/` in this repo.
- `test:ci-regression`: run after editing CI workflow files.
- `test:deployment`: run after editing deploy scripts or Docker config.
- `test:windows-bootstrap-gate`: run after editing Windows bootstrap or enrollment scripts.
- `test:smoke`: every describe is skipped unless `SMOKE_TEST_URL` is set. `test:smoke:staging` and `test:smoke:production` **make live HTTP requests** to the deployed host.
- `build`: turbo build of `@classroompath/api` and `@classroompath/react-spa` in dependency order; required before docker image builds or e2e tests.
- `db:test:reset`: **destroys the local test DB containers and volumes**, then starts postgres again; data loss is expected.
- `submodule:update`: **advances `upstream/openpath`** to the latest commit on its remote default branch; review the diff before committing the pointer bump.

Release and deploy (operational work: see Public Repository Posture):

- `release:preflight`, `release:status`: read-only reports (pass/block for the next release; local promotion status).
- `release:evidence-bundle`: assembles verifiable evidence from artifacts, after a staging deploy and before production promotion.
- `release:promote`: **canonical inspect entry point; dry-run by default**. With `--execute` it runs the full promotion sequence (evidence validation, staging deploy, health check, tag push, canary); `npm run release:promote -- --auto-tag --execute` is the orchestrated sequence.
- `promote:current-staging`: reads live staging state, verifies the staging-candidate SHA, then **creates and pushes the next patch production tag to origin**. Maintainers needing an explicit tag: `bash scripts/tag-production-release.sh <tag>`.
- `deploy:staging`: **deploys to the staging host over SSH**; requires `STAGING_HOST`, `STAGING_USER` and `STAGING_SSH_KEY` in `.env.local` or the environment, and prompts for confirmation. `deploy:staging:assume-yes` suppresses every prompt.
- `promote:production`, `promote:production:full`, `release:production`: **deprecated no-op shims** that print the canonical pair and exit 2 without acting. Do not use them.

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

- For an exact file or known symbol, read it directly or use targeted `rg`. For unknown relationships or broad navigation, use `graphify query "<identifiers>" --graph graphify-out/graph.json`, `graphify path` or `graphify explain` from this repo's root.
- A missing or irrelevant graph is not a blocker and does not authorize rebuilding it during read-only work.
- Query with code identifiers (function/file/symbol names), not prose questions -- start-node matching is literal substring matching on node labels. If results look irrelevant, grep graph.json node labels for your term first, then re-query with the labels you find.
- Always pass `--graph` explicitly; the default depends on the current working directory.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- The graph rebuilds automatically via the post-commit hook (background, log: `~/.cache/graphify-rebuild.log`). Manual refresh: `graphify update .` from this repo's root. `.graphifyignore` excludes `upstream/` -- the vendored OpenPath core is covered by its own graph at the workspace root.
