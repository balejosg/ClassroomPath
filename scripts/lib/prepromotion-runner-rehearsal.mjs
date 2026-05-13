import { existsSync, readFileSync } from 'node:fs';

import { parseReleaseStateText } from './release-state-contract.mjs';
import {
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
  WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOSTS,
} from './windows-auto-allow-canary-evidence.mjs';

export const EXPECTED_REDDIT_HOSTS = REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS;
export const EXPECTED_EXTERNAL_NAVIGATION_HOSTS = WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOSTS;

function isTrueFlag(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function isFalseFlag(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'false'
  );
}

function valueOrNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pageEventForHost(artifact, host) {
  const probe = REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES.find((candidate) => candidate.host === host);
  if (!probe) return false;
  return artifact?.redditDiagnostics?.page?.completedRedditDiagnosticEvents?.[probe.id] === true;
}

function artifactProvesHost(artifact, host) {
  const whitelist = artifact?.redditDiagnostics?.whitelist ?? {};
  return (
    pageEventForHost(artifact, host) ||
    whitelist?.global?.containsExpectedHosts?.[host] === true ||
    whitelist?.native?.containsExpectedHosts?.[host] === true
  );
}

function parseHostname(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostMatchesExpected(host, expectedHost) {
  const normalizedHost = String(host ?? '')
    .trim()
    .toLowerCase();
  const normalizedExpectedHost = String(expectedHost ?? '')
    .trim()
    .toLowerCase();
  return (
    normalizedHost === normalizedExpectedHost ||
    normalizedHost.endsWith(`.${normalizedExpectedHost}`)
  );
}

function artifactProvesExternalNavigation(
  artifact,
  expectedHosts = EXPECTED_EXTERNAL_NAVIGATION_HOSTS
) {
  const navigation = artifact?.allowlistedNavigation;
  if (
    navigation?.success !== true ||
    navigation.blockedByOpenPath === true ||
    navigation.timedOut === true
  ) {
    return false;
  }

  const observedHosts = [
    navigation.finalHost,
    parseHostname(navigation.href),
    parseHostname(navigation.url),
    ...(Array.isArray(navigation.expectedHosts) ? navigation.expectedHosts : []),
  ].filter(Boolean);

  return expectedHosts.every((expectedHost) =>
    observedHosts.some((observedHost) => hostMatchesExpected(observedHost, expectedHost))
  );
}

export function readStagingVerificationEnv(path) {
  return parseReleaseStateText(readFileSync(path, 'utf8'));
}

export function verifyWindowsAjaxArtifact({ artifactPath, expectedHosts = EXPECTED_REDDIT_HOSTS }) {
  if (!existsSync(artifactPath)) {
    return {
      state: 'required',
      reason: 'Direct runner rehearsal artifact is missing.',
      artifactPath,
      missingHosts: [],
    };
  }

  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch (error) {
    return {
      state: 'failed',
      reason: `Direct runner rehearsal artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      artifactPath,
      missingHosts: [...expectedHosts],
    };
  }

  const boundaryId = valueOrNull(artifact?.failureBoundary?.id);
  const missingHosts = expectedHosts.filter((host) => !artifactProvesHost(artifact, host));
  const externalNavigationPassed = artifactProvesExternalNavigation(artifact);

  if (boundaryId !== 'none') {
    return {
      state: 'failed',
      reason: `Direct runner rehearsal artifact failureBoundary.id is ${boundaryId ?? 'missing'}, expected none.`,
      artifactPath,
      missingHosts,
    };
  }

  if (!externalNavigationPassed) {
    return {
      state: 'failed',
      reason:
        'Direct runner rehearsal artifact is missing successful external allowlisted navigation evidence.',
      artifactPath,
      missingHosts,
    };
  }

  if (missingHosts.length > 0) {
    return {
      state: 'failed',
      reason: `Direct runner rehearsal artifact is missing Reddit host evidence: ${missingHosts.join(', ')}.`,
      artifactPath,
      missingHosts,
    };
  }

  return {
    state: 'passed',
    reason: 'Direct runner rehearsal passed for all expected Reddit hosts.',
    artifactPath,
    missingHosts: [],
  };
}

function linuxBootstrapEvidencePassed(stagingVerification) {
  const result = stagingVerification?.STAGING_LINUX_BOOTSTRAP_RESULT;
  const boundary = stagingVerification?.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID;
  return (
    result === 'success' || (result === 'skipped-lan-staging' && boundary === 'skipped-lan-staging')
  );
}

export function classifyPrepromotionRequirement({ stagingVerification, artifactPath }) {
  const highRisk = stagingVerification?.STAGING_WINDOWS_FIREFOX_HIGH_RISK;

  if (highRisk === undefined || highRisk === null || String(highRisk).trim() === '') {
    return {
      state: 'failed',
      reason: 'STAGING_WINDOWS_FIREFOX_HIGH_RISK is missing from staging verification evidence.',
      artifactPath,
      missingHosts: [],
    };
  }

  if (!isTrueFlag(highRisk)) {
    if (!isFalseFlag(highRisk)) {
      return {
        state: 'failed',
        reason: `STAGING_WINDOWS_FIREFOX_HIGH_RISK must be true or false, got ${highRisk}.`,
        artifactPath,
        missingHosts: [],
      };
    }

    return {
      state: 'not_required',
      reason: 'Staging verification says Windows/Firefox high risk is false.',
      artifactPath,
      missingHosts: [],
    };
  }

  const failures = [];
  for (const fieldName of ['STAGING_WINDOWS_BOOTSTRAP_RESULT', 'STAGING_FIREFOX_POLICY_RESULT']) {
    if (stagingVerification?.[fieldName] !== 'success') {
      failures.push(`${fieldName}=${stagingVerification?.[fieldName] ?? 'unset'}`);
    }
  }

  if (stagingVerification?.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT !== 'success') {
    failures.push(
      `STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT=${stagingVerification?.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT ?? 'unset'}`
    );
  }

  if (
    !valueOrNull(stagingVerification?.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA) ||
    stagingVerification?.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA !==
      stagingVerification?.STAGING_VERIFIED_APP_SHA
  ) {
    failures.push(
      `STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA=${stagingVerification?.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA ?? 'unset'}; STAGING_VERIFIED_APP_SHA=${stagingVerification?.STAGING_VERIFIED_APP_SHA ?? 'unset'}`
    );
  }

  if (stagingVerification?.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID !== 'none') {
    failures.push(
      `STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID=${stagingVerification?.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID ?? 'unset'}`
    );
  }

  if (!linuxBootstrapEvidencePassed(stagingVerification)) {
    failures.push(
      `STAGING_LINUX_BOOTSTRAP_RESULT=${stagingVerification?.STAGING_LINUX_BOOTSTRAP_RESULT ?? 'unset'}; STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID=${stagingVerification?.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID ?? 'unset'}`
    );
  }

  if (failures.length > 0) {
    return {
      state: 'failed',
      reason: `Preproduction runner evidence is missing or failed: ${failures.join(', ')}.`,
      artifactPath,
      missingHosts: [],
    };
  }

  return {
    state: 'passed',
    reason: 'Preproduction runner evidence passed for required staging lanes.',
    artifactPath,
    missingHosts: [],
  };
}
