# ClassroomPath Launch UAT Checklist

Date baseline: 2026-03-09

## Identity and access

- Register a new self-service user and confirm the terms version `2026-03-09` is persisted.
- Confirm the registration screen does not log the user in automatically.
- Confirm a verification email is sent through ClassroomPath's configured mail provider.
- Open the verification link and confirm login succeeds only after verification.
- Trigger "Reenviar verificacion" from login and confirm a fresh link is delivered.
- Accept an invitation, set the password, and confirm the invited user lands in the correct tenant.
- Trigger password recovery from the tenant admin view and from the reset screen.
- Confirm neither invitations nor password recovery ever expose secret-bearing links in the browser UI, even when delivery fails.
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
