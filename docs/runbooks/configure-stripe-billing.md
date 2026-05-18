# Public Note: Billing Provider Configuration

> Status: public stub
> Applies to: ClassroomPath public repository surface
> Source of truth: `docs/runbooks/configure-stripe-billing.md`

Billing-provider setup is operational material and is maintained privately. Public documentation
should not include provider account details, live webhook endpoints, secret inventories, generated
price identifiers, or commands that call billing APIs.

For code review, the relevant public surface is the source code, tests, and high-level contract
documentation. Any real billing credentials, webhook secrets, catalog identifiers, and provider
dashboard procedures belong in private operational documentation and secret stores.
