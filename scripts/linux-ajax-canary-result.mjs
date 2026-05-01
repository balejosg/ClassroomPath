export function evaluateLinuxAjaxBrowserPageOutcome({
  firstPageLoadCompleted,
  firstPageLoadError = null,
  browserNavigation = {},
  expectedProbeIds = [],
}) {
  const canaryState =
    browserNavigation.afterAttempts?.canaryState ??
    browserNavigation.beforeAttempts?.canaryState ??
    null;
  const attempts = Array.isArray(canaryState?.attempts) ? canaryState.attempts : [];
  const firstAttempt = attempts[0] ?? null;
  const failedProbeIds = expectedProbeIds.filter((probeId) => {
    return firstAttempt?.probes?.[probeId]?.ok !== true;
  });
  const timedOutProbeIds = failedProbeIds.filter((probeId) => {
    return /timed out/i.test(String(firstAttempt?.probes?.[probeId]?.error ?? ''));
  });

  return {
    success:
      firstPageLoadCompleted === true && firstAttempt !== null && failedProbeIds.length === 0,
    firstPageLoadCompleted: firstPageLoadCompleted === true,
    firstPageLoadError,
    firstAttemptCompleted: firstAttempt !== null,
    failedProbeIds,
    timedOutProbeIds,
    firstAttempt,
  };
}
