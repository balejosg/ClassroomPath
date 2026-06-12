/**
 * Models a single auto-allow canary observation event (probe hit, timing, outcome) and provides serialization helpers.
 *
 * Invoked by: Imported by canary harness and evidence scripts.
 * Usage: (library module, not invoked directly)
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function evidenceContainsAllExpectedHosts(evidence, expectedHosts = []) {
  if (!evidence?.containsExpectedHosts) {
    return false;
  }

  return expectedHosts.every((host) => evidence.containsExpectedHosts[host] === true);
}

export async function waitForEvidenceObservation({
  expectedHosts = [],
  timeoutMs = 0,
  intervalMs = 2000,
  collectors,
  matches = evidenceContainsAllExpectedHosts,
}) {
  const startedAt = Date.now();
  let evidence = await collectEvidence(collectors, expectedHosts);
  const observed = () =>
    Object.values(evidence).some((entry) => matches(entry, expectedHosts) === true);

  if (timeoutMs <= 0) {
    return {
      observed: observed(),
      timeoutMs,
      elapsedMs: Date.now() - startedAt,
      evidence,
    };
  }

  const deadline = startedAt + timeoutMs;
  while (Date.now() < deadline) {
    if (observed()) {
      return {
        observed: true,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        evidence,
      };
    }

    await sleep(intervalMs);
    evidence = await collectEvidence(collectors, expectedHosts);
  }

  return {
    observed: observed(),
    timeoutMs,
    elapsedMs: Date.now() - startedAt,
    evidence,
  };
}

async function collectEvidence(collectors, expectedHosts) {
  const entries = await Promise.all(
    Object.entries(collectors).map(async ([name, collect]) => [name, await collect(expectedHosts)])
  );

  return Object.fromEntries(entries);
}
