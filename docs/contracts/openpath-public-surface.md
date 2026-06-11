# Contract: OpenPath Public SPA Extension Surface

> Status: maintained
> Applies to: ClassroomPath SPA wrapper development
> Last verified: 2026-06-11
> Source of truth: `docs/contracts/openpath-public-surface.md`

## Architecture Chain

```
upstream/openpath/          (git submodule, read-only)
  react-spa/src/public/     upstream public entrypoints
        |
        | Vite aliases in react-spa/vite.config.ts
        | @openpath/public-auth   -> upstream/.../public/auth.ts
        | @openpath/public-google -> upstream/.../public/google.ts
        | @openpath/public-i18n   -> upstream/.../public/i18n.ts
        | @openpath/public-shell  -> upstream/.../public/shell.ts
        | @openpath/public-ui     -> upstream/.../public/ui.ts
        | @openpath/shared        -> upstream/openpath/shared/src
        | @openpath/openpath.css  -> upstream/.../src/index.css
        |
        v
  react-spa/src/openpath/   bridge files (this repo)
    public-auth.ts
    public-google.ts
    public-i18n.ts
    public-shell.ts
    public-ui.ts
    roles.ts
        |
        v
  ClassroomPath components
    ClassroomPathShell.tsx
    ClassroomPathApp.tsx
    (other components under react-spa/src/)
```

## Alias-to-Bridge Table

| @openpath alias         | Upstream target (relative to upstream/openpath/) | Bridge file                               |
| ----------------------- | ------------------------------------------------ | ----------------------------------------- |
| @openpath/public-auth   | react-spa/src/public/auth.ts                     | react-spa/src/openpath/public-auth.ts     |
| @openpath/public-google | react-spa/src/public/google.ts                   | react-spa/src/openpath/public-google.ts   |
| @openpath/public-i18n   | react-spa/src/public/i18n.ts                     | react-spa/src/openpath/public-i18n.ts     |
| @openpath/public-shell  | react-spa/src/public/shell.ts                    | react-spa/src/openpath/public-shell.ts    |
| @openpath/public-ui     | react-spa/src/public/ui.ts                       | react-spa/src/openpath/public-ui.ts       |
| @openpath/shared        | shared/src (index)                               | react-spa/src/openpath/roles.ts (partial) |
| @openpath/openpath.css  | react-spa/src/index.css                          | (imported directly; no bridge .ts file)   |

Note: the Vite alias for `@openpath/shared` bypasses the bridge layer -- imports like
`@openpath/shared/roles` resolve directly to the submodule. The `roles.ts` bridge re-exports
`normalizeUserRoleString` as the only currently needed shared symbol.

## Decision Rule: Wrapper Work vs. Upstream Proposal

### Edit the ClassroomPath wrapper when:

- Adding ClassroomPath-specific views, routes, billing flows, or org-management UI
- Composing or wrapping an OpenPath shell component with extra props, banners, or overrides
- Adding i18n keys specific to ClassroomPath (use the ClassroomPath i18n layer, not OpenPath's)
- Narrowing or re-exporting a subset of the public surface for internal use
- Fixing a bug that only affects ClassroomPath behaviour

### Propose a change to OpenPath upstream when:

- A capability is missing from the public surface that would benefit all downstream consumers
- A public export needs a new symbol or type that is not ClassroomPath-specific
- A bug in the upstream component affects correct behaviour regardless of the wrapper
- The OpenPath public surface itself needs to change (requires OpenPath maintainer review per
  ADR 0010: `upstream/openpath/docs/adr/0010-public-spa-extension-surface.md`)

Never edit files inside `upstream/openpath/` directly for ClassroomPath-only changes. The
submodule is pinned to a specific commit; edits inside it are silently discarded on the next
submodule update.

## Submodule Safety Notes

### Pinned commit

`upstream/openpath` is pinned to a specific commit recorded in `.gitmodules` and the parent
repo index. To see the current pin:

```
git submodule status upstream/openpath
```

### What breaks when the public surface changes

If OpenPath removes or renames an export in one of its `public/*.ts` entrypoints, the
corresponding bridge file in `react-spa/src/openpath/` will produce a TypeScript error at the
re-export line. The alias in `vite.config.ts` still resolves, but the named export no longer
exists upstream.

Detection: `npm run typecheck` inside `react-spa/` (or `tsc --noEmit`) catches removed or
renamed exports before the change reaches CI.

When OpenPath adds a new public export, the bridge file does not need to be updated immediately
-- the new symbol is simply not exposed to ClassroomPath until a maintainer adds it to the
relevant bridge file.

### Public-surface check

`scripts/check-public-surface.mjs` scans all git-tracked files for private infrastructure
identifiers, secrets, live hostnames, and staging URLs that must not appear in the public repo.
It does NOT check OpenPath public-surface import correctness -- that is covered by TypeScript.

Run it with:

```
npm run verify:public-surface
```

This check runs automatically as part of `npm run verify:commit` and the pre-push hook.

### Submodule update procedure

See `docs/runbooks/update-openpath-submodule.md` for the full update workflow. After any
submodule update, run:

1. `npm run typecheck` in `react-spa/` -- verifies bridge re-exports still compile
2. `npm test` in `react-spa/` -- verifies adapter boundary tests still pass
3. `npm run verify:public-surface` -- verifies no new private identifiers crept in

The adapter boundary test suite lives at:
`react-spa/src/openpath/__tests__/adapter-boundary.test.ts`
