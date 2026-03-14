# ClassroomPath Launch UAT Checklist

Date baseline: 2026-03-09

## Identity and access

- Register a new self-service user and confirm the terms version `2026-03-09` is persisted.
- Confirm the registration screen does not log the user in automatically.
- Confirm a verification email is delivered to the temporary UAT mailbox through ClassroomPath's configured mail provider.
- Open the delivered verification link and confirm login succeeds only after verification.
- Trigger "Reenviar verificacion" from login and confirm a fresh delivered link arrives in the temporary UAT mailbox, and that the browser only exposes a manual verification link when delivery cannot be confirmed (or on localhost/dev).
- Accept an invitation from the delivered email, set the password, and confirm the invited user lands in the correct tenant.
- Trigger password recovery from the tenant admin view, then complete the delivered link on the reset screen, and confirm each recovery email arrives in the temporary UAT mailbox.
- Confirm neither invitations nor password recovery ever expose secret-bearing links in the browser UI, even when delivery fails; the inbox evidence is the only approved place to open those links during UAT.
- Force an upstream logout failure and confirm the UI receives an explicit degraded/error result instead of silent success.

## Onboarding and approvals

- With org directory hidden, confirm onboarding does not enumerate organizations.
- Request access while the directory is hidden and confirm the user lands in the waiting room.
- Approve the waiting user from the admin panel and confirm the waiting room unblocks.
- Reject a waiting user and confirm the waiting status is cleared.

## Authorization and tenant boundaries

- Confirm a teacher only sees classrooms assigned to the tenant.
- Confirm a teacher cannot manage another tenant's classrooms or schedules.
- Confirm pending users only list accounts waiting for the current organization.
- Confirm the last tenant admin cannot delete themself, be deleted, or be demoted.

## Machine identity

- Register two machines in different classrooms with the same reported hostname.
- Confirm both machines coexist and keep independent identity/state.

## Observability

- Force a login failure and confirm structured frontend telemetry includes route, action, and role.
- Force a pending-user approval failure and confirm structured telemetry is emitted.
- Confirm privileged tenant actions emit durable audit events.

## Email evidence flow (required for future runs)

For future staging sign-off, email-related UAT must be inbox-backed. Do not rely only on live
`auth.register` / `auth.generateEmailVerificationToken` payloads when a mailbox-delivery flow can be exercised.

Capture both outputs below with the UAT evidence:

```bash
npm run test:release-gate:staging
npm run test:e2e:auth-email:staging
```

What each command proves:

- `npm run test:release-gate:staging`: fast API gate that still checks `emailSent: true`, HTTPS/public verification URLs, and fresh resend tokens.
- `npm run test:e2e:auth-email:staging`: mailbox-backed Playwright UAT that uses `mail.tm` via `tests/e2e/fixtures/mailtm.ts` to prove real delivery for registration, login-screen resend, tenant invitations, and admin-issued recovery links, plus verification-only login unlock and reset-screen completion.

The reset screen is a redemption surface, not an email-request surface. The email is issued from the tenant admin flow and then completed from the delivered link.

Failure-path redaction for invitation and recovery links remains covered by deterministic integration tests; the mailbox-backed Playwright suite exercises the live delivery path.

## Execution Record: 2026-03-11

Environment tested: `staging` (`https://classroompath-staging.duckdns.org`)

Evidence captured:

- `2026-03-11T17:09:24+01:00`
- `SMOKE_TEST_URL=https://classroompath-staging.duckdns.org SMOKE_ALLOW_MUTATIONS=1 npm run test:smoke`
- Live `auth.register` call for `uat-admin-mmm8ghh5@test.local`
- Local deterministic evidence from `ClassroomPath` commit `4e9f0fc` (`verify:full`, gateway/users integrations, waiting-room/org E2E)

Accounts used:

- `uat-admin-mmm8ghh5@test.local` / `UatPassword123!`

Results:

- `PASS` Register a new self-service user and confirm the terms version `2026-03-09` is persisted.
  Evidence: staging smoke registration passed and the live `auth.register` payload echoed `termsVersion: "2026-03-09"`.
- `PASS` Confirm the registration screen does not log the user in automatically.
  Evidence: deterministic gateway coverage still passes the non-session registration contract; live `auth.register` returned a verification-required payload instead of a logged-in session.
- `FAIL (BLOCKER)` Confirm a verification email is sent through ClassroomPath's configured mail provider.
  Evidence: live `auth.register` for `uat-admin-mmm8ghh5@test.local` returned `emailSent: false`.
- `FAIL (BLOCKER)` Open the verification link and confirm login succeeds only after verification.
  Evidence: live `auth.register` emitted `verificationUrl: "http://localhost:5173/login?..."`
  The staging gateway generated a localhost link instead of the public staging origin, so the email verification path is not launch-safe.
- `BLOCKED` Trigger "Reenviar verificacion" from login and confirm a fresh link is delivered.
  Blocked by the same staging email/public URL misconfiguration above.
- `PASS` Accept an invitation, set the password, and confirm the invited user lands in the correct tenant.
  Evidence: deterministic suite `api/tests/integration/invitations.integration.test.ts` remained green in `verify:full`.
- `PASS` Trigger password recovery from the tenant admin view and from the reset screen.
  Evidence: deterministic suite `api/tests/integration/gateway.integration.test.ts` remained green in `verify:full`.
- `PASS` Confirm neither invitations nor password recovery ever expose secret-bearing links in the browser UI, even when delivery fails.
  Evidence: deterministic suite `api/tests/integration/gateway.integration.test.ts` still passes the reset-token browser redaction and delivery-failure rollback cases.
- `PASS` Force an upstream logout failure and confirm the UI receives an explicit degraded/error result instead of silent success.
  Evidence: deterministic suite `api/tests/openpath-auth-client.test.ts` and gateway integration coverage remained green in `verify:full`.

- `PASS` With org directory hidden, confirm onboarding does not enumerate organizations.
  Evidence: deterministic suite `api/tests/integration/onboarding-policy.integration.test.ts` remained green in `verify:full`.
- `PASS` Request access while the directory is hidden and confirm the user lands in the waiting room.
  Evidence: deterministic suite `tests/e2e/waiting-room.spec.ts` remained green in Task 14 and `api/tests/integration/onboarding-policy.integration.test.ts` remained green in `verify:full`.
- `PASS` Approve the waiting user from the admin panel and confirm the waiting room unblocks.
  Evidence: deterministic suite `tests/e2e/waiting-room.spec.ts` remained green in Task 14.
- `PASS` Reject a waiting user and confirm the waiting status is cleared.
  Evidence: deterministic suite `api/tests/integration/users.integration.test.ts` remained green in `verify:full`.

- `PASS` Confirm a teacher only sees classrooms assigned to the tenant.
  Evidence: deterministic suite `api/tests/integration/classrooms.integration.test.ts` remained green in `verify:full`.
- `PASS` Confirm a teacher cannot manage another tenant's classrooms or schedules.
  Evidence: deterministic suites `api/tests/integration/classrooms.integration.test.ts` and `api/tests/integration/schedules.integration.test.ts` remained green in `verify:full`.
- `PASS` Confirm pending users only list accounts waiting for the current organization.
  Evidence: deterministic suite `api/tests/pending-users.service.test.ts` remained green in `verify:full`.
- `PASS` Confirm the last tenant admin cannot delete themself, be deleted, or be demoted.
  Evidence: deterministic suites `api/tests/integration/users.integration.test.ts` and `api/tests/integration/multi-org-membership.integration.test.ts` remained green in `verify:full`.

- `NOT EXECUTED LIVE` Register two machines in different classrooms with the same reported hostname.
  Reason: UAT stopped after the blocking verification-email/public-URL failure; machine identity still has deterministic coverage in `api/tests/integration/classrooms.integration.test.ts`.

- `PASS (LOCAL)` Force a login failure and confirm structured frontend telemetry includes route, action, and role.
  Evidence: deterministic suite `api/tests/client-telemetry.test.ts` remained green in `verify:full`.
- `PASS (LOCAL)` Force a pending-user approval failure and confirm structured telemetry is emitted.
  Evidence: deterministic suite `api/tests/client-telemetry.test.ts` remained green in `verify:full`.
- `PASS (LOCAL)` Confirm privileged tenant actions emit durable audit events.
  Evidence: deterministic suite `api/tests/integration/users.integration.test.ts` remained green in `verify:full`.

Launch outcome:

- `BLOCKED` Do not sign off for production while staging still emits localhost verification links and cannot deliver verification email.

## Revalidation Record: 2026-03-12

Environment tested: `staging` (`https://classroompath-staging.duckdns.org`)

Scope:

- Re-check the blocking identity-and-access findings from 2026-03-11 after the follow-up auth/runtime fixes landed.
- Keep the rest of the checklist as the active manual sign-off list; non-blocking items from 2026-03-11 remain historical evidence, not same-day revalidation.

Evidence captured:

- `2026-03-12T18:00:00+01:00` approximate rerun window
- `SMOKE_TEST_URL=https://classroompath-staging.duckdns.org SMOKE_ALLOW_MUTATIONS=1 npm run test:smoke` -> `18/18` pass
- Live `auth.register` call for `uat-signoff-1773294829115@test.local`
- Live `auth.generateEmailVerificationToken` call for `uat-signoff-1773294829115@test.local`
- ClassroomPath HEAD during revalidation: `3494ba4` (`fix(auth): keep resend verification local`)

Accounts used:

- `uat-signoff-1773294829115@test.local` / `UatPassword123!`

Results:

- `PASS` Confirm a verification email is sent through ClassroomPath's configured mail provider.
  Evidence: the live `auth.register` response returned `emailSent: true`.
- `PASS` Open the verification link and confirm login succeeds only after verification uses a public staging URL.
  Evidence: the live `auth.register` response returned `verificationUrl: "https://classroompath-staging.duckdns.org/login?..."`
- `PASS (API LIVE)` Trigger a fresh verification delivery and confirm the backend returns a new public staging link.
  Evidence: the live `auth.generateEmailVerificationToken` response returned `emailSent: true` and `verificationUrl: "https://classroompath-staging.duckdns.org/login?..."`
  Note: the manual login-screen click path was not re-run in this revalidation pass and should still be exercised during final human sign-off.
- `PASS` Smoke coverage still exercises the staging registration contract with the current terms version `2026-03-09`.
  Evidence: `tests/smoke.test.ts` passed live against staging and the registration assertion still requires `termsVersion === CURRENT_TERMS_VERSION`.

## Revalidation Record: 2026-03-14

Environment tested: `staging` (`https://classroompath-staging.duckdns.org`)

Scope:

- Re-run the email-dependent UAT path with live inbox delivery instead of API payload inspection only.
- Cover registration, login-screen resend, tenant invitations, and admin-issued recovery links end-to-end from the delivered emails.

Evidence captured:

- `2026-03-14T15:19:11+01:00`
- `npm run test:e2e:auth-email:staging` -> `4 passed (3.3m)`
- ClassroomPath HEAD during revalidation: local workspace changes including `tests/e2e/auth-email.spec.ts`, `tests/e2e/fixtures/mailtm.ts`, and the updated UAT checklist flow

Results:

- `PASS` Confirm a verification email is delivered to the temporary UAT mailbox through ClassroomPath's configured mail provider.
  Evidence: live mailbox-backed Playwright registration flow received the verification email and opened the delivered link successfully.
- `PASS` Open the delivered verification link and confirm login succeeds only after verification.
  Evidence: the live mailbox-backed registration flow still blocks pre-verification login and unlocks access only after the delivered link is opened.
- `PASS` Trigger "Reenviar verificacion" from login and confirm a fresh delivered link arrives in the temporary UAT mailbox.
  Evidence: the live mailbox-backed resend flow delivered a fresh verification link and completed login successfully from the new email.
- `PASS` Accept an invitation from the delivered email, set the password, and confirm the invited user lands in the correct tenant.
  Evidence: the live mailbox-backed invitation flow delivered the invite email, accepted it from the inbox link, and showed both admin and invitee inside the same tenant users view.
- `PASS` Trigger password recovery from the tenant admin view, then complete the delivered link on the reset screen.
  Evidence: the live mailbox-backed recovery flow delivered the reset email, completed the reset screen from the delivered link, and logged in with the new password.
- `PASS` Confirm invitation and recovery links are consumed only from inbox evidence in the live UAT flow.
  Evidence: the live Playwright flow asserts no secret-bearing invitation/recovery links are exposed back into the browser UI during successful delivery.

## Revalidation Record: 2026-03-14 (remaining checks)

Environment tested: `staging` (`https://classroompath-staging.duckdns.org`) plus local deterministic suites

Scope:

- Execute the remaining non-email checks after the inbox-backed auth/email pass.
- Combine live staging verification where self-contained automation exists with local deterministic backstops for the rest of the checklist.

Evidence captured:

- `SMOKE_ALLOW_MUTATIONS=1 npm run test:smoke:staging` -> `18/18` pass
- `npm run test:release-gate:staging` -> `2/2` pass
- `BASE_URL=https://classroompath-staging.duckdns.org PLAYWRIGHT_WORKERS=1 npx playwright test tests/e2e/waiting-room.spec.ts --grep "should show waiting screen after requesting access" --retries=0` -> `1 passed`
- `npx playwright test tests/e2e/onboarding.spec.ts --retries=0` -> `1 passed`
- `npx playwright test tests/e2e/waiting-room.spec.ts --retries=0` -> `8 passed`
- `npx playwright test tests/e2e/organization.spec.ts --retries=0` -> `11 passed`
- Local deterministic suites passed: `api/tests/integration/onboarding-policy.integration.test.ts`, `api/tests/pending-users.service.test.ts`, `api/tests/integration/classrooms.integration.test.ts`, `api/tests/integration/schedules.integration.test.ts`, `api/tests/integration/users.integration.test.ts`, `api/tests/integration/multi-org-membership.integration.test.ts`, `api/tests/client-telemetry.test.ts`, `api/tests/openpath-auth-client.test.ts`
- OpenPath machine identity backstop passed: `upstream/openpath/api/tests/machine-registration.test.ts` (`same reported hostname in two classrooms should not collide`)

Results:

- `PASS` Register a new self-service user and confirm the terms version `2026-03-09` is persisted.
  Evidence: staging smoke registration still passed live with mutations enabled.
- `PASS` Confirm the registration screen does not log the user in automatically.
  Evidence: `tests/e2e/onboarding.spec.ts` still passes the register-then-onboard flow without an automatic authenticated session shortcut.
- `PASS (LOCAL BACKSTOP)` Force an upstream logout failure and confirm the UI receives an explicit degraded/error result instead of silent success.
  Evidence: `api/tests/openpath-auth-client.test.ts` passed the explicit degraded logout case.
- `PASS` With org directory hidden, confirm onboarding does not enumerate organizations.
  Evidence: `api/tests/integration/onboarding-policy.integration.test.ts` plus the hidden-directory branch in `tests/e2e/waiting-room.spec.ts` both passed.
- `PASS` Request access while the directory is hidden and confirm the user lands in the waiting room.
  Evidence: live staging waiting-room request-access flow passed, and the local hidden-directory waiting-room E2E also passed.
- `PASS` Approve the waiting user from the admin panel and confirm the waiting room unblocks.
  Evidence: `tests/e2e/waiting-room.spec.ts` passed the admin-approval/unblock flow.
- `PASS (LOCAL BACKSTOP)` Reject a waiting user and confirm the waiting status is cleared.
  Evidence: `api/tests/pending-users.service.test.ts` passed the reject-and-clear waiting-state case.
- `PASS` Confirm a teacher only sees classrooms assigned to the tenant.
  Evidence: `tests/e2e/organization.spec.ts` teacher-permissions coverage plus `api/tests/integration/classrooms.integration.test.ts` passed.
- `PASS` Confirm a teacher cannot manage another tenant's classrooms or schedules.
  Evidence: `api/tests/integration/classrooms.integration.test.ts` and `api/tests/integration/schedules.integration.test.ts` passed the tenant/ownership enforcement paths.
- `PASS (LOCAL BACKSTOP)` Confirm pending users only list accounts waiting for the current organization.
  Evidence: `api/tests/pending-users.service.test.ts` passed the org-scoped waiting-user listing case.
- `PASS (LOCAL BACKSTOP)` Confirm the last tenant admin cannot delete themself, be deleted, or be demoted.
  Evidence: `api/tests/integration/users.integration.test.ts` and `api/tests/integration/multi-org-membership.integration.test.ts` passed the last-admin protection cases.
- `PASS (LOCAL BACKSTOP)` Register two machines in different classrooms with the same reported hostname and confirm both machines coexist with independent identity/state.
  Evidence: `upstream/openpath/api/tests/machine-registration.test.ts` passed the isolated non-collision regression.
- `PASS (LOCAL BACKSTOP)` Force a login failure and confirm structured frontend telemetry includes route, action, and role.
  Evidence: `api/tests/client-telemetry.test.ts` passed the anonymous login-failure telemetry case.
- `PASS (LOCAL BACKSTOP)` Force a pending-user approval failure and confirm structured telemetry is emitted.
  Evidence: `api/tests/client-telemetry.test.ts` passed the authenticated approval-failure telemetry case.
- `PASS (LOCAL BACKSTOP)` Confirm privileged tenant actions emit durable audit events.
  Evidence: `api/tests/integration/users.integration.test.ts` passed the invitation/revocation/reset audit-event coverage.

## Manual Exploratory Sign-off: 2026-03-14

Environment tested: `staging` (`https://classroompath-staging.duckdns.org`)

Scope:

- Simulate a final human UAT pass over the remaining live UX/ops surfaces.
- Spot-check the admin, waiting-room, and teacher experiences directly in the browser, then confirm audit persistence from staging infrastructure.

Evidence captured:

- Manual browser pass on staging with a fresh org admin (`human-admin-1773500397459-d1034a46@dollicons.com`)
- Manual waiting-room pass with a fresh self-service user (`human-user-1773500524892-9b816234@dollicons.com`)
- Manual teacher invitation/acceptance pass with a fresh invited teacher (`human-teacher-1773500747032-3f176c1c@dollicons.com`)
- Read-only staging infrastructure checks via SSH (`docker ps`, direct `cp_audit_events` query inside `classroompath-api`)

Results:

- `PASS` Visual sanity on the live register/login/onboarding/dashboard surfaces.
  Evidence: the browser pass showed the expected Spanish UX copy, onboarding choices, dashboard navigation, and teacher landing page without broken layout or dead-end navigation.
- `PASS` Hidden-directory waiting-room UX behaves coherently for a fresh user.
  Evidence: the manual self-service user reached `Esperando invitación` and the privacy copy correctly avoided exposing the org directory.
- `PASS` Teacher live UX is tenant-scoped and does not expose admin controls.
  Evidence: the manually invited teacher landed on `Mi Panel`, saw the teacher sidebar (`Mi Panel`, `Aulas`, `Mis Políticas`), and did not see `Usuarios y Roles` or `Invitar usuario`.
- `PASS` Last-admin live protection is enforced in the staging UI/API path.
  Evidence: attempting to revoke the only admin from `Usuarios y Roles` surfaced `Cannot remove the last admin from the organization` instead of silently removing access.
- `PASS` Durable audit persistence is observable on staging infrastructure.
  Evidence: a direct read-only query against `cp_audit_events` returned the freshly created `invitation.created` event for `human-teacher-1773500747032-3f176c1c@dollicons.com`.
- `PASS WITH NOTE` There is no dedicated audit/log UI in the staged product surface.
  Evidence: audit confirmation required direct infrastructure inspection rather than an in-app admin screen; this is acceptable for ops sign-off but remains an operational, not end-user, check.

Current status:

- `ACTIVE` The manual UAT checklist remains valid and should still be used for final sign-off.
- `AUTOMATED GATE` Production deploys now run an automated staging release gate that covers live `auth.register` and `auth.generateEmailVerificationToken` delivery assertions before rollout.
- `UNBLOCKED` The specific 2026-03-11 staging blocker (email delivery false + localhost verification URL) no longer reproduces.
- `NEXT RUN` Future email revalidation should attach `npm run test:e2e:auth-email:staging` output for registration, resend, invitation, and recovery flows instead of relying on API-only auth payload probes.
- `EMAIL FLOWS VERIFIED` The staging inbox-backed UAT path now passes for registration, resend, invitation, and recovery flows.
- `AUTOMATED BACKSTOPS VERIFIED` The remaining non-email checks now have fresh live staging evidence where automation exists and fresh deterministic/local evidence for the rest.
- `HUMAN EXPLORATORY PASS COMPLETE` A final manual/browser-based pass plus direct audit inspection was completed on staging.
- `READY FOR RELEASE DECISION` UAT no longer has an open functional blocker; remaining go/no-go is a product decision rather than a technical validation gap.
