# Verification Refactor Phase 3 Follow-ups

This phase completed:

- diff-safe stage caching for selected verification stages
- formal verification report contract v2 with owners and required approvals
- shared verification catalog for domains, stages, and regression plans
- shared CLI helpers across the remaining release/report scripts
- CI change detection wired to the shared verification catalog

Next high-ROI follow-ups:

- Expand stage caching from diff-safe skips to artifact-aware caching with explicit validators per stage.
- Publish verification reports as CI artifacts and consume them directly in release gates instead of treating them as step-local files.
- Drive CODEOWNERS or reviewer-routing outputs from the shared verification catalog so ownership and approvals stay aligned.
- Keep shrinking the shell-heavy deploy surfaces, especially `scripts/deploy-production-remote.sh`, into narrower shared helpers with testable boundaries.
- Move the remaining verification/release policy decisions onto the shared catalog until `verify`, `ci`, and deploy workflows all consume the same source of truth.
