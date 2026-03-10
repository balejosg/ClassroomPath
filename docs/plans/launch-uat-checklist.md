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

## Onboarding and approvals

- With org directory hidden, confirm onboarding does not enumerate organizations.
- Request access while the directory is hidden and confirm the user lands in the waiting room.
- Approve the waiting user from the admin panel and confirm the waiting room unblocks.
- Reject a waiting user and confirm the waiting status is cleared.

## Authorization and tenant boundaries

- Confirm a teacher only sees classrooms assigned to the tenant.
- Confirm a teacher cannot manage another tenant's classrooms or schedules.
- Confirm pending users only list accounts waiting for the current organization.

## Machine identity

- Register two machines in different classrooms with the same reported hostname.
- Confirm both machines coexist and keep independent identity/state.

## Observability

- Force a login failure and confirm structured frontend telemetry includes route, action, and role.
- Force a pending-user approval failure and confirm structured telemetry is emitted.
