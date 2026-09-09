#!/usr/bin/env node

/**
 * CLI for reading, writing, and validating the promotion-evidence snapshot used by the release-state gate.
 *
 * Invoked by: GitHub Actions deploy and staging workflows; `release-state-cli.test.ts`.
 * Usage: node scripts/promotion-evidence-cli.mjs read|write|validate [options]
 * Env: RELEASE_STATE_PATH.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { isDirectExecution } from './lib/github-actions.mjs';
import { parseCommandLine, requireCliOption, runCli } from './lib/release-cli.mjs';
import {
  getReleaseStateSnapshotFields,
  parseReleaseStateText,
  serializeReleaseStateSnapshot,
} from './lib/release-state-contract.mjs';

const BEGIN_MARKER = 'CLASSROOMPATH_PROMOTION_EVIDENCE_V1_BEGIN';
const END_MARKER = 'CLASSROOMPATH_PROMOTION_EVIDENCE_V1_END';
const VALUE_FLAGS = [
  '--tag',
  '--commit',
  '--release-id',
  '--rc-run-id',
  '--classroompath-sha',
  '--openpath-sha',
  '--contract-sha256',
  '--staging-current',
  '--staging-verification',
  '--output',
  '--message-file',
  '--staging-current-output',
  '--staging-verification-output',
  '--identity-output',
  '--existing-message-file',
];

const RELEASE_ID_PATTERN = /^[0-9a-f]{64}$/;
const CLASSROOMPATH_SHA_PATTERN = /^[0-9a-f]{40}$/;
const OPENPATH_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CONTRACT_SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * @typedef {{openpathSha: string; contractSha256: string}} OpenPathTagIdentity
 * @typedef {{releaseId: string; rcRunId: string; classroomPathSha: string} & OpenPathTagIdentity} ProductionTagIdentity
 */

/**
 * @param {string|undefined} openpathSha
 * @param {string|undefined} contractSha256
 * @returns {OpenPathTagIdentity}
 */
function normalizeOpenPathTagIdentity(openpathSha, contractSha256) {
  const normalizedOpenpathSha = String(openpathSha ?? '').trim();
  const normalizedContractSha256 = String(contractSha256 ?? '').trim();
  if (!normalizedOpenpathSha || !normalizedContractSha256) {
    throw new Error('openpathSha and contractSha256 are required together');
  }
  if (!OPENPATH_SHA_PATTERN.test(normalizedOpenpathSha)) {
    throw new Error('openpathSha must be a 40-character lowercase SHA');
  }
  if (!CONTRACT_SHA256_PATTERN.test(normalizedContractSha256)) {
    throw new Error('contractSha256 must be a 64-character lowercase SHA-256 hex string');
  }
  return { openpathSha: normalizedOpenpathSha, contractSha256: normalizedContractSha256 };
}

function extractUniqueMarker(messageText, markerName) {
  const values = [
    ...String(messageText ?? '').matchAll(new RegExp(`^${markerName}:\\s*(\\S+)\\s*$`, 'gmu')),
  ].map((match) => match[1]);
  if (values.length === 0) {
    throw new Error(`Promotion tag identity is missing ${markerName}`);
  }
  if (values.length > 1) {
    throw new Error(`Promotion tag identity contains duplicate ${markerName}`);
  }
  return values[0];
}

/**
 * @param {{releaseId?: string; rcRunId?: string; classroomPathSha?: string} & OpenPathTagIdentity} [identity]
 * @returns {ProductionTagIdentity}
 */
export function buildProductionTagIdentity({
  releaseId,
  rcRunId,
  classroomPathSha,
  openpathSha,
  contractSha256,
} = {}) {
  const normalizedReleaseId = String(releaseId ?? '').trim();
  const normalizedRcRunId = String(rcRunId ?? '').trim();
  const normalizedClassroomPathSha = String(classroomPathSha ?? '').trim();
  if (!RELEASE_ID_PATTERN.test(normalizedReleaseId)) {
    throw new Error('releaseId must be a 64-character lowercase SHA-256 hex string');
  }
  if (!/^[0-9]+$/.test(normalizedRcRunId)) {
    throw new Error('rcRunId is required and must be a numeric GitHub run id');
  }
  if (!CLASSROOMPATH_SHA_PATTERN.test(normalizedClassroomPathSha)) {
    throw new Error('classroomPathSha must be a 40-character lowercase SHA');
  }
  return {
    releaseId: normalizedReleaseId,
    rcRunId: normalizedRcRunId,
    classroomPathSha: normalizedClassroomPathSha,
    ...normalizeOpenPathTagIdentity(openpathSha, contractSha256),
  };
}

export function extractProductionTagIdentity(messageText) {
  return buildProductionTagIdentity({
    releaseId: extractUniqueMarker(messageText, 'ClassroomPath-Release-Id'),
    rcRunId: extractUniqueMarker(messageText, 'ClassroomPath-RC-Run-Id'),
    classroomPathSha: extractUniqueMarker(messageText, 'ClassroomPath-SHA'),
    openpathSha: extractUniqueMarker(messageText, 'OpenPath-SHA'),
    contractSha256: extractUniqueMarker(messageText, 'OpenPath-Contract-SHA256'),
  });
}

export function compareProductionTagIdentity(actual, expected) {
  const actualIdentity = buildProductionTagIdentity(actual);
  const expectedIdentity = buildProductionTagIdentity(expected);
  const fields = ['releaseId', 'rcRunId', 'classroomPathSha', 'openpathSha', 'contractSha256'];
  const mismatches = fields.filter((field) => actualIdentity[field] !== expectedIdentity[field]);
  return {
    matches: mismatches.length === 0,
    mismatches,
  };
}

export function serializeProductionTagIdentity(identity) {
  const validated = buildProductionTagIdentity(identity);
  return [
    `RELEASE_ID=${validated.releaseId}`,
    `RC_RUN_ID=${validated.rcRunId}`,
    `CLASSROOMPATH_SHA=${validated.classroomPathSha}`,
    `OPENPATH_SHA=${validated.openpathSha}`,
    `OPENPATH_CONTRACT_SHA256=${validated.contractSha256}`,
    '',
  ].join('\n');
}

export function writeProductionTagIdentityFile(outputPath, identity) {
  writeFileSync(outputPath, serializeProductionTagIdentity(identity), 'utf-8');
  return outputPath;
}

function requireOption(options, name) {
  return requireCliOption(options, name, `Missing required option --${name}`);
}

function encodeSnapshot(path, snapshotType) {
  const text = readFileSync(path, 'utf-8');
  if (Buffer.byteLength(text, 'utf8') > 65536) {
    throw new Error(`Promotion ${snapshotType} evidence exceeds the bounded size limit`);
  }
  const allowed = new Set(getReleaseStateSnapshotFields(snapshotType));
  const seen = new Set();
  for (const line of text.split(/\r?\n/u)) {
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Promotion ${snapshotType} evidence contains a malformed line`);
    }
    const key = line.slice(0, separatorIndex);
    if (!allowed.has(key) || seen.has(key)) {
      throw new Error(`Promotion ${snapshotType} evidence contains an unsafe or duplicate field`);
    }
    seen.add(key);
  }
  const canonical = serializeReleaseStateSnapshot(snapshotType, parseReleaseStateText(text));
  return Buffer.from(canonical, 'utf-8').toString('base64');
}

function decodeField(fields, name) {
  const value = fields.get(name);
  if (!value) {
    throw new Error(`Promotion tag evidence is missing ${name}`);
  }
  return Buffer.from(value, 'base64').toString('utf-8');
}

function extractEvidenceFields(messageText) {
  const beginIndex = messageText.indexOf(BEGIN_MARKER);
  const endIndex = messageText.indexOf(END_MARKER);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    throw new Error('Promotion tag evidence block not found');
  }

  const block = messageText
    .slice(beginIndex + BEGIN_MARKER.length, endIndex)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const fields = new Map();

  for (const line of block) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      throw new Error(`Invalid promotion evidence line: ${line}`);
    }
    const name = line.slice(0, separatorIndex);
    if (fields.has(name)) {
      throw new Error(`Duplicate promotion evidence field: ${name}`);
    }
    fields.set(name, line.slice(separatorIndex + 1));
  }

  return fields;
}

function writeTagMessage(options) {
  const tag = requireOption(options, 'tag');
  const commit = requireOption(options, 'commit');
  const stagingCurrentPath = requireOption(options, 'staging-current');
  const stagingVerificationPath = requireOption(options, 'staging-verification');
  const outputPath = requireOption(options, 'output');
  const releaseId = options['release-id'] ?? '';
  const rcRunId = options['rc-run-id'] ?? '';
  const classroomPathSha = options['classroompath-sha'] ?? commit;
  const openpathSha = options['openpath-sha'] ?? '';
  const contractSha256 = options['contract-sha256'] ?? '';
  const hasIdentityOption = Boolean(
    releaseId || rcRunId || options['classroompath-sha'] || openpathSha || contractSha256
  );
  const identity = hasIdentityOption
    ? buildProductionTagIdentity({
        releaseId,
        rcRunId,
        classroomPathSha,
        openpathSha,
        contractSha256,
      })
    : null;

  const message = [
    `ClassroomPath production release ${tag}`,
    '',
    `Commit: ${commit}`,
    ...(identity
      ? [
          `ClassroomPath-Release-Id: ${identity.releaseId}`,
          `ClassroomPath-RC-Run-Id: ${identity.rcRunId}`,
          `ClassroomPath-SHA: ${identity.classroomPathSha}`,
          ...(identity.openpathSha
            ? [
                `OpenPath-SHA: ${identity.openpathSha}`,
                `OpenPath-Contract-SHA256: ${identity.contractSha256}`,
              ]
            : []),
        ]
      : []),
    'Promotion evidence: staging release state was verified locally before tag creation.',
    BEGIN_MARKER,
    `staging-current-images.env.base64=${encodeSnapshot(stagingCurrentPath, 'current-runtime')}`,
    `staging-verification.env.base64=${encodeSnapshot(stagingVerificationPath, 'staging-verification')}`,
    END_MARKER,
    '',
  ].join('\n');

  writeFileSync(outputPath, message, 'utf-8');
}

function extractTagMessage(options) {
  const messagePath = requireOption(options, 'message-file');
  const stagingCurrentOutput = requireOption(options, 'staging-current-output');
  const stagingVerificationOutput = requireOption(options, 'staging-verification-output');
  const messageText = readFileSync(messagePath, 'utf-8');
  const fields = extractEvidenceFields(messageText);

  writeFileSync(
    stagingCurrentOutput,
    decodeField(fields, 'staging-current-images.env.base64'),
    'utf-8'
  );
  writeFileSync(
    stagingVerificationOutput,
    decodeField(fields, 'staging-verification.env.base64'),
    'utf-8'
  );

  const hasReleaseIdentity =
    /^(?:ClassroomPath-Release-Id|ClassroomPath-RC-Run-Id|ClassroomPath-SHA):/mu.test(messageText);
  if (hasReleaseIdentity) {
    const identity = extractProductionTagIdentity(messageText);
    const identityOutput = options['identity-output'];
    if (identityOutput) {
      writeProductionTagIdentityFile(identityOutput, identity);
    }
  }
}

function extractTagIdentity(options) {
  const messagePath = requireOption(options, 'message-file');
  const outputPath = requireOption(options, 'identity-output');
  const identity = extractProductionTagIdentity(readFileSync(messagePath, 'utf-8'));
  writeProductionTagIdentityFile(outputPath, identity);
}

function writeTagIdentity(options) {
  const outputPath = requireOption(options, 'identity-output');
  writeProductionTagIdentityFile(
    outputPath,
    buildProductionTagIdentity({
      releaseId: requireOption(options, 'release-id'),
      rcRunId: requireOption(options, 'rc-run-id'),
      classroomPathSha: requireOption(options, 'classroompath-sha'),
      openpathSha: options['openpath-sha'],
      contractSha256: options['contract-sha256'],
    })
  );
}

function verifyTagIdentity(options) {
  const messagePath = requireOption(options, 'message-file');
  const messageText = readFileSync(messagePath, 'utf-8');
  const expectedTag = String(options.tag ?? '').trim();
  if (expectedTag) {
    const expectedHeader = `ClassroomPath production release ${expectedTag}`;
    if (messageText.split(/\r?\n/u, 1)[0] !== expectedHeader) {
      throw new Error(`Production tag message is not bound to tag ${expectedTag}`);
    }
  }
  const actual = extractProductionTagIdentity(messageText);
  const expected = buildProductionTagIdentity({
    releaseId: requireOption(options, 'release-id'),
    rcRunId: requireOption(options, 'rc-run-id'),
    classroomPathSha: requireOption(options, 'classroompath-sha'),
    openpathSha: options['openpath-sha'],
    contractSha256: options['contract-sha256'],
  });
  const comparison = compareProductionTagIdentity(actual, expected);
  if (!comparison.matches) {
    throw new Error(
      `Production tag identity conflicts with the exact Release Bundle: ${comparison.mismatches.join(', ')}`
    );
  }
}

function main(argv) {
  const { command, options } = parseCommandLine(argv, { valueFlags: VALUE_FLAGS });

  switch (command) {
    case 'write-tag-message':
      writeTagMessage(options);
      return;
    case 'extract-tag-message':
      extractTagMessage(options);
      return;
    case 'extract-tag-identity':
      extractTagIdentity(options);
      return;
    case 'write-tag-identity':
      writeTagIdentity(options);
      return;
    case 'verify-tag-identity':
      verifyTagIdentity(options);
      return;
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  runCli(main);
}
