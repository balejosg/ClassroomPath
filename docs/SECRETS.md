# Secrets And Private Operations

> Status: public stub
> Applies to: ClassroomPath public repository surface
> Source of truth: `docs/SECRETS.md`

ClassroomPath uses secrets for authentication, sessions, email, billing, deployment, release
automation, and private infrastructure access. Exact secret inventories, host bindings, key names,
rotation procedures, and provider setup steps are maintained privately.

Public repository rules:

- Do not commit real `.env` files, private keys, API keys, OAuth secrets, webhook secrets, SSH keys,
  certificates, database URLs, deployment hosts, or private infrastructure paths.
- Keep `config/.env.example`, `.env.local.example`, and `config/deploy-targets.example.json` limited
  to blank values and `.invalid` or `example.com` placeholders.
- Store real runtime values in private secret stores or untracked local files.
- Rotate any credential that may have appeared in git history, public issues, workflow logs,
  artifacts, releases, packages, screenshots, or support material.

Use `npm run verify:public-surface` before publishing changes that touch docs, config, workflows, or
operational scripts.
