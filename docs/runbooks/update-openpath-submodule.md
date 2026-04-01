# Runbook: Update OpenPath Submodule

> Status: maintained
> Applies to: ClassroomPath -> OpenPath updates
> Last verified: 2026-03-13
> Source of truth: `docs/runbooks/update-openpath-submodule.md`

ClassroomPath consumes OpenPath as a git submodule at `upstream/openpath/`.

Before changing the ClassroomPath wrapper around OpenPath, also review:

- [`agent-manifest.json`](../../../agent-manifest.json)
- [`OpenPath/docs/INDEX.md`](../../../OpenPath/docs/INDEX.md)
- [`OpenPath/docs/adr/0010-public-spa-extension-surface.md`](../../../OpenPath/docs/adr/0010-public-spa-extension-surface.md)

## Steps

1. Land and push the OpenPath change in the OpenPath repo.
2. In ClassroomPath, update the submodule pointer:

```bash
npm run submodule:update
git add upstream/openpath
git commit -m "chore: update openpath submodule"
git push origin main
```

3. Deploy staging (mandatory):

```bash
npm run deploy:staging
```

4. If staging passes and the change is approved for production, promote using:

- [`docs/runbooks/deploy-production.md`](deploy-production.md)

## Notes

- Do not edit files inside `upstream/openpath/` directly; changes will be lost on the next submodule update.
- ClassroomPath should consume the OpenPath React SPA only through the public entrypoints exported by `@openpath/react-spa` (`public-ui`, `public-shell`, `public-auth`, `public-google`, `openpath.css`).
- Treat `upstream/openpath/` as a dependency surface, not the first place to search for ordinary ClassroomPath wrapper work.
