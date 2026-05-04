# Staging QA Fixtures

> Applies to: manual browser QA in `http://192.168.1.114:3000`
> Source of truth: `config/staging-qa-fixtures.json`

Use deterministic ClassroomPath-hosted fixture pages for student browser checks. External education
sites can redirect, challenge, or change independently of ClassroomPath, so they are not suitable as
the first QA signal.

## Fixture Contract

Each staging QA group must provide:

- one allowed page that renders in Firefox within 10 seconds
- one allowed page with a same-origin AJAX request
- one non-allowed URL for request-access
- one blocked subdomain rule
- one blocked path rule

The maintained manifest is:

```bash
config/staging-qa-fixtures.json
```

The controlled pages are served by the ClassroomPath gateway:

- `/cp/qa-fixtures/basic`
- `/cp/qa-fixtures/ajax`
- `/cp/qa-fixtures/ajax.js`
- `/cp/qa-fixtures/ajax.json`

Blocked-path fixtures use `example.com/openpath-blocked-path` because the OpenPath Linux client
protects the ClassroomPath control-plane host from path-level block rules.

## Apply To Staging Data

Generate the deterministic SQL from the manifest and apply it to the staging PostgreSQL database:

```bash
node scripts/apply-staging-qa-fixtures.mjs > /tmp/staging-qa-fixtures.sql
ssh root@192.168.1.150 \
  "pct exec 113 -- docker exec -i classroompath-postgres-staging psql -U classroompath -d classroompath_staging" \
  < /tmp/staging-qa-fixtures.sql
```

The script refuses non-staging manifests and only targets the maintained staging QA classroom/group
set.

## Validate Before Manual QA

Run the fixture validator before enrolling or resetting the visible student VM:

```bash
node scripts/validate-staging-qa-fixtures.mjs
```

The validator fails when an allowed/request-access URL does not resolve, redirects to another host,
returns an unsuitable HTTP status, or when the controlled pages do not render in Firefox. It does not
replace the final visible `student-linux` pass; it only removes fragile-domain noise before that pass.

## Student VM Pass

After the manifest validates:

1. Roll back Proxmox `104` / `student-linux` to `student-linux-desktop-clean`.
2. Enroll it against staging.
3. In visible Firefox, test the allowed, allowed-AJAX, request-access, blocked-subdomain, and
   blocked-path entries for each active group in `config/staging-qa-fixtures.json`.
4. Leave the VM rolled back to the clean snapshot and powered off when QA is complete.
