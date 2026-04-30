import { existsSync, readFileSync } from 'node:fs';

import { parseReleaseStateText } from './release-state-contract.mjs';
import {
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
} from './windows-auto-allow-canary-evidence.mjs';

export const EXPECTED_REDDIT_HOSTS = REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS;

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

  if (boundaryId !== 'none') {
    return {
      state: 'failed',
      reason: `Direct runner rehearsal artifact failureBoundary.id is ${boundaryId ?? 'missing'}, expected none.`,
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

  return verifyWindowsAjaxArtifact({ artifactPath });
}
