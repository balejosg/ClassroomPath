# Runbook: Update OpenPath Submodule

> Status: maintained
> Applies to: ClassroomPath -> OpenPath updates
> Last verified: 2026-03-05
> Source of truth: `docs/runbooks/update-openpath-submodule.md`

ClassroomPath consumes OpenPath as a git submodule at `upstream/openpath/`.

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

## Notes

- Do not edit files inside `upstream/openpath/` directly; changes will be lost on the next submodule update.
