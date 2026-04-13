# ClassroomPath Claims And Evidence

> Status: maintained
> Applies to: buyer-facing evaluation and technical claim review
> Last verified: 2026-04-13
> Source of truth: `docs/evaluation/claims-and-evidence.md`

Use this table to keep product claims tied to repo-hosted evidence.

| Claim                                                                 | What supports it today                                                | Source                                                                                                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The core is auditable                                                 | The underlying core is published in a separate public repository      | [OpenPath repository](https://github.com/balejosg/openpath)                                                                                      |
| Session secrets are not intentionally stored in browser local storage | Sensitive auth material is documented as cookie-backed and `HttpOnly` | [`../SESSION_SECURITY_MODEL.md`](../SESSION_SECURITY_MODEL.md)                                                                                   |
| Cookie-authenticated mutations enforce origin checks                  | The session security model documents the CSRF and origin boundary     | [`../SESSION_SECURITY_MODEL.md`](../SESSION_SECURITY_MODEL.md)                                                                                   |
| Release promotion is documented                                       | Staging and production runbooks are maintained in this repo           | [`../runbooks/deploy-staging.md`](../runbooks/deploy-staging.md), [`../runbooks/deploy-production.md`](../runbooks/deploy-production.md)         |
| The wrapper boundary is explicit                                      | The wrapper consumes the documented OpenPath public surface           | [`../../upstream/openpath/docs/adr/0010-public-spa-extension-surface.md`](../../upstream/openpath/docs/adr/0010-public-spa-extension-surface.md) |
| Buyer-facing evaluation docs are maintained                           | This directory is indexed as part of the maintained docs set          | [`../INDEX.md`](../INDEX.md)                                                                                                                     |

## Claims We Do Not Make Here

This repository does not currently claim:

- FERPA, GDPR, ISO, or SOC certification
- a specific SLA or support tier
- identity integrations not documented in code or maintained docs
- that the product removes the need for local policy ownership

If one of those claims becomes necessary, it should only be added with an explicit source of truth.
