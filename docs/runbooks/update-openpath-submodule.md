# Runbook: Update OpenPath Submodule

> Status: maintained
> Applies to: ClassroomPath updates that consume a newer OpenPath commit
> Last verified: 2026-04-16
> Source of truth: `docs/runbooks/update-openpath-submodule.md`

ClassroomPath consumes OpenPath as a git submodule at `upstream/openpath/`.

Before changing the ClassroomPath wrapper around OpenPath, also review:

- `agent-manifest.json` in the workspace root
- [`upstream/openpath/docs/INDEX.md`](../../upstream/openpath/docs/INDEX.md)
- [`upstream/openpath/docs/adr/0010-public-spa-extension-surface.md`](../../upstream/openpath/docs/adr/0010-public-spa-extension-surface.md)

## Public Workflow

ClassroomPath consumes OpenPath as a dependency. Public review should verify that changes continue
to use documented OpenPath public entrypoints and do not edit `upstream/openpath/` directly for
ClassroomPath-only behavior.

For private maintainer operations, submodule update, release, and deployment steps are maintained in
private operational documentation.

## Rules

- do not edit files inside `upstream/openpath/` directly for normal ClassroomPath work
- consume OpenPath SPA capabilities through the documented public entrypoints only:
  - `@openpath/public-ui`
  - `@openpath/public-shell`
  - `@openpath/public-auth`
  - `@openpath/public-google`
  - `@openpath/openpath.css`
- treat `upstream/openpath/` as a dependency surface, not the first place to search for ordinary wrapper changes
