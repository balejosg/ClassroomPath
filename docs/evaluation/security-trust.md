# ClassroomPath Security And Trust Guide

> Status: maintained
> Applies to: school IT teams evaluating ClassroomPath
> Last verified: 2026-04-13
> Source of truth: `docs/evaluation/security-trust.md`

ClassroomPath is designed to give evaluators a clear answer to three questions:

1. Can we inspect the core we would depend on?
2. Can we understand the security boundary around user sessions and admin actions?
3. Is the service operated through documented, reviewable contracts rather than opaque manual steps?

## What You Can Verify Today

### 1. The core is public and auditable

- OpenPath, the core engine behind ClassroomPath, is published at [`balejosg/openpath`](https://github.com/balejosg/openpath).
- ClassroomPath is a bounded wrapper around that core rather than a fork that hides the operational boundary.
- The supported wrapper boundary is documented in [`../../upstream/openpath/docs/adr/0010-public-spa-extension-surface.md`](../../upstream/openpath/docs/adr/0010-public-spa-extension-surface.md).

### 2. Sensitive session material stays in cookies, not in browser storage

Current documented behavior:

- access and refresh tokens are stored in `HttpOnly` cookies
- cookies become `Secure` in production
- cookie-authenticated mutations enforce origin checks
- logout clears local session cookies

Source: [`../SESSION_SECURITY_MODEL.md`](../SESSION_SECURITY_MODEL.md)

### 3. Public security posture is documented

OpenPath publishes:

- disclosure workflow and operational baseline in [`../../upstream/openpath/SECURITY.md`](../../upstream/openpath/SECURITY.md)
- operator hardening guidance in [`../../upstream/openpath/docs/SECURITY-HARDENING.md`](../../upstream/openpath/docs/SECURITY-HARDENING.md)
- browser extension privacy posture in [`../../upstream/openpath/firefox-extension/PRIVACY.md`](../../upstream/openpath/firefox-extension/PRIVACY.md)

### 4. Deploy and promotion paths are repo-hosted

The documented release shape is visible in this repository:

- staging deploy workflow: [`../runbooks/deploy-staging.md`](../runbooks/deploy-staging.md)
- production promotion workflow: [`../runbooks/deploy-production.md`](../runbooks/deploy-production.md)
- canonical route and runtime contract: [`../contracts/routes-ports.md`](../contracts/routes-ports.md)

### 5. The product boundary is explicit

- OpenPath remains the OSS core under `AGPL-3.0-or-later`
- ClassroomPath is the managed service under the ClassroomPath Source-Available License 1.0
- the comparison is documented in [`openpath-vs-classroompath.md`](openpath-vs-classroompath.md)

## What To Review During Evaluation

- Whether your school wants a managed service or direct self-operation of the OSS core
- Which endpoints, browsers, and classroom devices you need to cover first
- How your internal approval flow should handle policy changes, invitations, and delegated administration
- What rollout evidence you need from a pilot before a wider deployment

Use [`it-evaluation-checklist.md`](it-evaluation-checklist.md) as the working checklist.

## What This Repository Does Not Claim

This guide does not claim:

- FERPA, GDPR, ISO, or SOC certification
- a specific SLA or support tier
- identity-provider integrations that are not documented in this repo
- "set and forget" operation without any local policy ownership from the school

If one of those points is mandatory for your evaluation, raise it explicitly during the commercial review at [classroompath.example.invalid](https://classroompath.example.invalid/).
