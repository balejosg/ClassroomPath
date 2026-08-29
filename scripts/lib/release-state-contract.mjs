/**
 * Defines the release state contract: shell-compatible snapshot fields, promotion-evidence validation, and signed Firefox gate.
 *
 * Invoked by: Imported by release state and promotion evidence CLIs; tested by `release-state-cli.test.ts`.
 * Usage: (library module, not invoked directly)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  buildPromotionEligibilityOutputs as buildPromotionEligibilityOutputsFromReleaseEvidence,
  buildStagingReleaseEvidenceOutputs as buildStagingReleaseEvidenceOutputsFromReleaseEvidence,
  evaluatePromotionEligibility as evaluatePromotionEligibilityFromReleaseEvidence,
  validateCurrentReleaseState as validateCurrentReleaseStateFromReleaseEvidence,
  validateHighRiskStagingVerification as validateHighRiskStagingVerificationFromReleaseEvidence,
  validateSignedFirefoxReleaseStagingVerification as validateSignedFirefoxReleaseStagingVerificationFromReleaseEvidence,
  validateStagingVerification as validateStagingVerificationFromReleaseEvidence,
} from './release-evidence-snapshot.mjs';

export const RELEASE_STATE_SNAPSHOT_DEFINITIONS = {
  'current-runtime': [
    'APP_SHA',
    'IMAGE_SOURCE',
    'CLASSROOMPATH_GATEWAY_IMAGE',
    'CLASSROOMPATH_MIGRATIONS_IMAGE',
    'OPENPATH_FIREFOX_ASSETS_IMAGE',
    'OPENPATH_API_IMAGE',
    'OPENPATH_VERSION',
    'OPENPATH_LINUX_AGENT_VERSION',
    'CLASSROOMPATH_SPA_IMAGE',
    'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION',
    'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT',
    'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG',
    'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256',
  ],
  'deploy-context': [
    'TARGET_SHA',
    'APP_SHA',
    'PREVIOUS_APP_SHA',
    'IMAGE_SOURCE',
    'MIGRATION_RISK_LEVEL',
    'MIGRATION_CHANGED_FILES',
    'MIGRATION_DESTRUCTIVE_FILES',
    'MIGRATION_EXPAND_FILES',
    'MIGRATION_SAFE_FILES',
    'PRODUCTION_BACKUP_REFERENCE',
    'DB_MIGRATED',
    'FAILURE_STAGE',
    'DEPLOY_FAILURE_STAGE',
    'ROLLBACK_ATTEMPTED',
    'ROLLBACK_RESULT',
  ],
  'staging-verification': [
    'STAGING_VERIFICATION_STATE',
    'STAGING_EXPECTED_APP_SHA',
    'STAGING_EXPECTED_OPENPATH_SHA',
    'STAGING_EXPECTED_IMAGE_SOURCE',
    'STAGING_VERIFICATION_STARTED_AT',
    'STAGING_VERIFIED_AT',
    'STAGING_VERIFIED_BY',
    'STAGING_VERIFIED_APP_SHA',
    'STAGING_VERIFIED_OPENPATH_SHA',
    'STAGING_VERIFIED_IMAGE_SOURCE',
    'STAGING_VERIFIED_GATEWAY_IMAGE',
    'STAGING_VERIFIED_MIGRATIONS_IMAGE',
    'STAGING_VERIFIED_OPENPATH_FIREFOX_ASSETS_IMAGE',
    'STAGING_VERIFIED_OPENPATH_API_IMAGE',
    'STAGING_VERIFIED_OPENPATH_VERSION',
    'STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION',
    'STAGING_VERIFIED_SPA_IMAGE',
    'STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS',
    'STAGING_EMAIL_PREFLIGHT_MODE',
    'STAGING_EMAIL_DELIVERY_HIGH_RISK',
    'STAGING_EMAIL_PREFLIGHT_RESULT',
    'STAGING_EMAIL_PREFLIGHT_PROVIDER',
    'STAGING_WINDOWS_FIREFOX_HIGH_RISK',
    'STAGING_SMOKE_RESULT',
    'STAGING_SMOKE_STATUS',
    'STAGING_RELEASE_GATE_RESULT',
    'STAGING_ENROLLMENT_DOWNLOAD_RESULT',
    'STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT',
    'STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT',
    'STAGING_WINDOWS_BOOTSTRAP_RESULT',
    'STAGING_FIREFOX_POLICY_RESULT',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE',
    'STAGING_FIREFOX_EXTENSION_ID',
    'STAGING_FIREFOX_RELEASE_VERSION',
    'STAGING_FIREFOX_SIGNATURE_SOURCE',
    'STAGING_FIREFOX_SIGNATURE_STATE',
    'STAGING_FIREFOX_METADATA_SHA256',
    'STAGING_FIREFOX_XPI_SHA256',
    'STAGING_LINUX_BOOTSTRAP_RESULT',
    'STAGING_LINUX_BOOTSTRAP_RUN_ID',
    'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID',
    'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE',
    'STAGING_WINDOWS_SELF_UPDATE_RESULT',
    'STAGING_LINUX_SELF_UPDATE_RESULT',
    'STAGING_PREPROMOTION_REHEARSAL_RESULT',
  ],
  'staging-verification-run': [
    'SMOKE_TARGET_URL',
    'SMOKE_SKIP_CORS',
    'STAGING_SMOKE_RESULT',
    'STAGING_SMOKE_STATUS',
    'RELEASE_GATE_TARGET_URL',
    'RELEASE_GATE_EXPECTED_ORIGIN',
    'STAGING_RELEASE_GATE_RESULT',
    'STAGING_ENROLLMENT_DOWNLOAD_RESULT',
    'STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT',
    'STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT',
    'STAGING_VERIFIED_AT',
    'STAGING_EMAIL_PREFLIGHT_MODE',
    'STAGING_EMAIL_DELIVERY_HIGH_RISK',
    'STAGING_EMAIL_PREFLIGHT_RESULT',
    'STAGING_EMAIL_PREFLIGHT_PROVIDER',
    'STAGING_WINDOWS_FIREFOX_HIGH_RISK',
    'STAGING_FIREFOX_RELEASE_ARTIFACTS',
    'STAGING_WINDOWS_BOOTSTRAP_RESULT',
    'STAGING_FIREFOX_POLICY_RESULT',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE',
    'STAGING_FIREFOX_EXTENSION_ID',
    'STAGING_FIREFOX_RELEASE_VERSION',
    'STAGING_FIREFOX_SIGNATURE_SOURCE',
    'STAGING_FIREFOX_SIGNATURE_STATE',
    'STAGING_FIREFOX_METADATA_SHA256',
    'STAGING_FIREFOX_XPI_SHA256',
    'STAGING_LINUX_BOOTSTRAP_RESULT',
    'STAGING_LINUX_BOOTSTRAP_RUN_ID',
    'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID',
    'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE',
    'STAGING_WINDOWS_SELF_UPDATE_RESULT',
    'STAGING_LINUX_SELF_UPDATE_RESULT',
    'STAGING_PREPROMOTION_REHEARSAL_RESULT',
  ],
};

const SAFE_SHELL_VALUE_RE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function assertSnapshotType(snapshotType) {
  if (!(snapshotType in RELEASE_STATE_SNAPSHOT_DEFINITIONS)) {
    throw new Error(`Unknown release state snapshot type: ${snapshotType}`);
  }

  return RELEASE_STATE_SNAPSHOT_DEFINITIONS[snapshotType];
}

export function getReleaseStateSnapshotFields(snapshotType) {
  return [...assertSnapshotType(snapshotType)];
}

function decodeAnsiCString(text) {
  let output = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char !== '\\') {
      output += char;
      continue;
    }

    index += 1;

    if (index >= text.length) {
      output += '\\';
      break;
    }

    const escape = text[index];

    switch (escape) {
      case 'a':
        output += '\u0007';
        break;
      case 'b':
        output += '\b';
        break;
      case 'e':
      case 'E':
        output += '\u001b';
        break;
      case 'f':
        output += '\f';
        break;
      case 'n':
        output += '\n';
        break;
      case 'r':
        output += '\r';
        break;
      case 't':
        output += '\t';
        break;
      case 'v':
        output += '\v';
        break;
      case '\\':
        output += '\\';
        break;
      case "'":
        output += "'";
        break;
      case '"':
        output += '"';
        break;
      case 'x': {
        const hex = text.slice(index + 1, index + 3);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          output += String.fromCodePoint(Number.parseInt(hex, 16));
          index += 2;
        } else {
          output += 'x';
        }
        break;
      }
      case 'u': {
        const hex = text.slice(index + 1, index + 5);
        if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
          output += String.fromCodePoint(Number.parseInt(hex, 16));
          index += 4;
        } else {
          output += 'u';
        }
        break;
      }
      case 'U': {
        const hex = text.slice(index + 1, index + 9);
        if (/^[0-9A-Fa-f]{8}$/.test(hex)) {
          output += String.fromCodePoint(Number.parseInt(hex, 16));
          index += 8;
        } else {
          output += 'U';
        }
        break;
      }
      default: {
        if (/[0-7]/.test(escape)) {
          let octal = escape;
          let consumed = 0;

          while (consumed < 2 && index + 1 < text.length && /[0-7]/.test(text[index + 1])) {
            octal += text[index + 1];
            index += 1;
            consumed += 1;
          }

          output += String.fromCodePoint(Number.parseInt(octal, 8));
        } else {
          output += escape;
        }
      }
    }
  }

  return output;
}

function parseShellValue(rawValue) {
  if (rawValue === "''") {
    return '';
  }

  if (rawValue.startsWith("$'") && rawValue.endsWith("'")) {
    return decodeAnsiCString(rawValue.slice(2, -1));
  }

  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1);
  }

  let value = '';

  for (let index = 0; index < rawValue.length; index += 1) {
    const char = rawValue[index];

    if (char === '\\' && index + 1 < rawValue.length) {
      value += rawValue[index + 1];
      index += 1;
      continue;
    }

    value += char;
  }

  return value;
}

function escapeAnsiCString(value) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\\']/g, (char) => {
    switch (char) {
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      case '\v':
        return '\\v';
      case '\f':
        return '\\f';
      case '\b':
        return '\\b';
      case '\\':
        return '\\\\';
      case "'":
        return "\\'";
      default:
        return `\\x${char.codePointAt(0).toString(16).padStart(2, '0')}`;
    }
  });
}

export function shellQuote(value) {
  const normalized = String(value ?? '');

  if (normalized.length === 0) {
    return "''";
  }

  if (SAFE_SHELL_VALUE_RE.test(normalized)) {
    return normalized;
  }

  if (/[\u0000-\u001f\u007f-\u009f'\\]/.test(normalized)) {
    return `$'${escapeAnsiCString(normalized)}'`;
  }

  return normalized.replace(/([^A-Za-z0-9_@%+=:,./-])/g, '\\$1');
}

export function parseReleaseStateText(text) {
  const snapshot = {};

  for (const line of text.split(/\r?\n/u)) {
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex);
    const rawValue = line.slice(separatorIndex + 1);
    snapshot[key] = parseShellValue(rawValue);
  }

  return snapshot;
}

export function readReleaseStateSnapshot(snapshotPath) {
  return parseReleaseStateText(readFileSync(snapshotPath, 'utf-8'));
}

export function collectReleaseStateSnapshot(snapshotType, source = process.env) {
  const fields = getReleaseStateSnapshotFields(snapshotType);
  return Object.fromEntries(fields.map((field) => [field, String(source[field] ?? '')]));
}

export function serializeReleaseStateSnapshot(snapshotType, source = process.env) {
  const snapshot = collectReleaseStateSnapshot(snapshotType, source);
  return `${Object.entries(snapshot)
    .map(([field, value]) => `${field}=${shellQuote(value)}`)
    .join('\n')}\n`;
}

export function writeReleaseStateSnapshot(snapshotType, snapshotPath, source = process.env) {
  mkdirSync(dirname(resolve(snapshotPath)), { recursive: true });
  writeFileSync(snapshotPath, serializeReleaseStateSnapshot(snapshotType, source), 'utf-8');
}

export function validateCurrentReleaseState(snapshot, expected) {
  return validateCurrentReleaseStateFromReleaseEvidence(snapshot, expected);
}

export function validateStagingVerification(snapshot, expected) {
  return validateStagingVerificationFromReleaseEvidence(snapshot, expected);
}

export function validateSignedFirefoxReleaseStagingVerification(snapshot) {
  return validateSignedFirefoxReleaseStagingVerificationFromReleaseEvidence(snapshot);
}

export function validateHighRiskStagingVerification(snapshot) {
  return validateHighRiskStagingVerificationFromReleaseEvidence(snapshot);
}

export function buildStagingReleaseEvidenceOutputs(snapshot) {
  return buildStagingReleaseEvidenceOutputsFromReleaseEvidence(snapshot);
}

export function validateReleaseStatePromotionEvidence({
  deploymentMode = 'promotion-eligible',
  imageSource,
  currentState,
  verificationState,
  expectedRuntime,
  highRisk = false,
}) {
  return evaluatePromotionEligibilityFromReleaseEvidence({
    deploymentMode,
    imageSource: imageSource ?? currentState?.IMAGE_SOURCE ?? 'source-build',
    currentState,
    verificationState,
    expectedRuntime,
    highRisk,
  });
}

export function buildReleaseStatePromotionOutputs(report) {
  return buildPromotionEligibilityOutputsFromReleaseEvidence(report);
}
