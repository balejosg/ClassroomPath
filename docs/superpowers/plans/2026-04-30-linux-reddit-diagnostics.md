# Linux Reddit Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Windows-shape Reddit diagnostics to the Linux AJAX auto-allow canary artifact and normalize them in release-evidence parsing.

**Architecture:** Keep the Linux change small by reusing the existing Windows Reddit host/probe constants and emitting the same `redditDiagnostics` top-level artifact shape from the Linux canary. Extend the Linux release-evidence parser to normalize Linux Reddit evidence into the existing `redditHosts` view without changing the rest of the Linux probe or failure-boundary flow.

**Tech Stack:** Node.js ESM scripts, repo-local `node:test` contract tests, JSON artifact parsing

---

### Task 1: Add Failing Contract Tests

**Files:**

- Modify: `tests/linux-auto-allow-canary.test.ts`
- Modify: `tests/release-evidence-bundle.test.ts`
- Test: `tests/linux-auto-allow-canary.test.ts`
- Test: `tests/release-evidence-bundle.test.ts`

- [ ] **Step 1: Write the failing Linux canary contract test**

Add assertions that prove the Linux canary script references the shared Reddit host/probe constants and emits `redditDiagnostics`:

```ts
assert.ok(canaryScript.includes('REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS'));
assert.ok(canaryScript.includes('REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES'));
assert.ok(canaryScript.includes('redditDiagnostics'));
assert.ok(canaryScript.includes('completedRedditDiagnosticEvents'));
```

- [ ] **Step 2: Run the focused Linux canary test to verify it fails**

Run: `node --test tests/linux-auto-allow-canary.test.ts`
Expected: FAIL in the new Linux Reddit diagnostics assertion because the script does not yet include those identifiers.

- [ ] **Step 3: Write the failing Linux release-evidence parser test**

Extend the Linux artifact fixture to include:

```ts
redditDiagnostics: {
  page: {
    completedRedditDiagnosticEvents: {
      'reddit-emoji-image': true,
      'reddit-external-preview-image': false,
      'reddit-i-image': true,
      'reddit-stylesheet': true,
      'reddit-static-script': false,
    },
  },
  whitelist: {
    local: {
      containsExpectedHosts: {
        'emoji.redditmedia.com': true,
        'external-preview.redd.it': false,
        'i.redd.it': true,
        'styles.redditmedia.com': true,
        'www.redditstatic.com': false,
      },
    },
  },
}
```

Then add assertions like:

```ts
assert.equal(linux.redditHosts['emoji.redditmedia.com'].globalWhitelist, true);
assert.equal(linux.redditHosts['emoji.redditmedia.com'].nativeWhitelist, false);
assert.equal(linux.redditHosts['emoji.redditmedia.com'].pageEvent, true);
assert.equal(linux.redditHosts['www.redditstatic.com'].pageEvent, false);
```

- [ ] **Step 4: Run the focused release-evidence parser test to verify it fails**

Run: `node --test tests/release-evidence-bundle.test.ts`
Expected: FAIL because `parseLinuxBootstrapCanaryArtifact(...)` does not yet return `redditHosts`.

### Task 2: Implement Minimal Linux Artifact Support

**Files:**

- Modify: `scripts/linux-ajax-auto-allow-canary.mjs`
- Modify: `scripts/lib/release-evidence-bundle.mjs`
- Test: `tests/linux-auto-allow-canary.test.ts`
- Test: `tests/release-evidence-bundle.test.ts`

- [ ] **Step 1: Import the shared Reddit constants into the Linux canary**

Add this import near the existing Linux helper imports:

```js
import {
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
} from './lib/windows-auto-allow-canary-evidence.mjs';
```

- [ ] **Step 2: Add a minimal Linux Reddit diagnostics collector**

In `scripts/linux-ajax-auto-allow-canary.mjs`, add a helper that returns:

```js
async function collectRedditDiagnostics(phase, pageEvidence = {}) {
  const [localWhitelist, canaryGroup] = await Promise.all([
    readFileEvidence(WHITELIST_PATH, REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS),
    collectCanaryGroupDiagnostics(),
  ]);

  return {
    phase,
    collectedAt: new Date().toISOString(),
    hosts: REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
    probes: REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
    page: pageEvidence,
    whitelist: {
      local: localWhitelist,
    },
    server: {
      canaryGroup,
    },
  };
}
```

- [ ] **Step 3: Attach Linux Reddit diagnostics to the final artifact summary**

Before building the final `summary`, collect Reddit page evidence from browser state and pass the full Reddit diagnostics object into `withLinuxAutoAllowDiagnostics(...)` input:

```js
const redditDiagnostics = await collectRedditDiagnostics(
  success ? 'post-success' : 'post-failure',
  {
    completedRedditDiagnosticEvents:
      browserNavigationAfterAttempts.canaryState?.completedRedditDiagnosticEvents ?? {},
    pageResourceCandidateEvents,
  }
);
```

Then include it in the summary input:

```js
redditDiagnostics,
```

- [ ] **Step 4: Normalize Linux Reddit evidence in the release parser**

Update `parseLinuxBootstrapCanaryArtifact(...)` in `scripts/lib/release-evidence-bundle.mjs` to return:

```js
const whitelist = artifact?.redditDiagnostics?.whitelist ?? {};
const pageDiagnostics = artifact?.redditDiagnostics?.page ?? {};

return {
  failureBoundary: normalizeFailureBoundary(artifact?.failureBoundary),
  diagnosticPhases: normalizeDiagnosticPhases(artifact?.diagnosticPhases),
  redditHosts: Object.fromEntries(
    REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS.map((host) => [
      host,
      {
        globalWhitelist: whitelist?.local?.containsExpectedHosts?.[host] === true,
        nativeWhitelist: whitelist?.native?.containsExpectedHosts?.[host] === true,
        pageEvent: getRedditPageEventByHost(pageDiagnostics, host),
      },
    ])
  ),
};
```

- [ ] **Step 5: Run the focused tests to verify they now pass**

Run: `node --test tests/linux-auto-allow-canary.test.ts tests/release-evidence-bundle.test.ts`
Expected: PASS

### Task 3: Refine and Verify

**Files:**

- Modify: `tests/linux-auto-allow-canary.test.ts`
- Modify: `tests/release-evidence-bundle.test.ts`
- Modify: `scripts/linux-ajax-auto-allow-canary.mjs`
- Modify: `scripts/lib/release-evidence-bundle.mjs`

- [ ] **Step 1: Keep the change minimal and remove any accidental extra contract drift**

Check that the Linux artifact only adds `redditDiagnostics` and does not alter unrelated Linux auto-allow fields or boundary logic.

- [ ] **Step 2: Re-run the focused local lane**

Run: `node --test tests/linux-auto-allow-canary.test.ts tests/release-evidence-bundle.test.ts`
Expected: PASS with no new failures in these files.

- [ ] **Step 3: Report verification evidence**

Record that the first and highest evidence rung reached for this task is:

```text
unit/contract test
```
