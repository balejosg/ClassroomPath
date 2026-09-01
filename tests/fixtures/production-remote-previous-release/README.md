# Production remote predecessor fixture

This fixture is the versioned minimum remote contract for the predecessor
release used by the N→N+1 bootstrap regression. It is intentionally based on
the pre-hermetic-executor contract at ClassroomPath revision `13fb026` and is
kept in the test tree so shallow checkouts do not reconstruct a predecessor by
copying the candidate tree.

The fixture deliberately has no production host-contract, deployment
transaction, rollback-executor, or recovery-executor helper. Those files are
candidate-only additions and must first arrive through the streamed entrypoint
and the candidate checkout.
