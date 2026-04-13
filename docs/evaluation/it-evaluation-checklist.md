# ClassroomPath IT Evaluation Checklist

> Status: maintained
> Applies to: technical and operational product evaluation
> Last verified: 2026-04-13
> Source of truth: `docs/evaluation/it-evaluation-checklist.md`

Use this checklist to decide whether to evaluate OpenPath directly or move forward with ClassroomPath as the managed path.

## 1. Decide The Operating Model

- [ ] We want to self-host and operate the core ourselves.
- [ ] We want a managed service, pilot, or pricing conversation first.
- [ ] We understand the difference documented in [`openpath-vs-classroompath.md`](openpath-vs-classroompath.md).

If the answer is mostly self-hosted, also review the OpenPath adoption path at [`balejosg/openpath/docs/evaluation/adoption-path.md`](https://github.com/balejosg/openpath/blob/main/docs/evaluation/adoption-path.md).

## 2. Review Trust And Security Evidence

- [ ] We reviewed the ClassroomPath session boundary in [`../SESSION_SECURITY_MODEL.md`](../SESSION_SECURITY_MODEL.md).
- [ ] We reviewed OpenPath disclosure and hardening guidance in [`../../upstream/openpath/SECURITY.md`](../../upstream/openpath/SECURITY.md) and [`../../upstream/openpath/docs/SECURITY-HARDENING.md`](../../upstream/openpath/docs/SECURITY-HARDENING.md).
- [ ] We reviewed the browser extension privacy posture in [`../../upstream/openpath/firefox-extension/PRIVACY.md`](../../upstream/openpath/firefox-extension/PRIVACY.md).
- [ ] We understand which claims are documented and which would need separate confirmation.

## 3. Confirm Deployment Fit

- [ ] We know which environment would be our first evaluation target.
- [ ] We understand the public entrypoint and route ownership documented in [`../contracts/routes-ports.md`](../contracts/routes-ports.md).
- [ ] We understand that ClassroomPath promotes `main` to staging first and production by `v*` tags only.
- [ ] We know whether our first evaluation should be a limited pilot or a broader rollout.

## 4. Confirm Endpoint And Operational Scope

- [ ] We know which Linux or Windows endpoints are in scope first.
- [ ] We know whether browser rollout and blocked-resource diagnosis are part of the evaluation.
- [ ] We know who will approve access changes and how delegated administration should work internally.

## 5. Decide The Next Step

- [ ] Technical review of the OSS core in [`balejosg/openpath`](https://github.com/balejosg/openpath)
- [ ] Product comparison in [`openpath-vs-classroompath.md`](openpath-vs-classroompath.md)
- [ ] Commercial follow-up for demo, pilot, or pricing at [classroompath.eu](https://classroompath.eu/)

If any required condition remains unanswered after this checklist, do not treat the product as approved. Record the missing item and resolve it during the evaluation process.
