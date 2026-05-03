#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

function parseArgs(argv) {
  const options = {
    artifactPath: 'runner-health-evidence.json',
    phase: '',
    dnsServersJson: '',
    artifactEndpointReachable: '',
    openpathStatusJson: '',
    failureBoundaryId: '',
    failureBoundaryMessage: '',
    targetUrl: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--artifact') options.artifactPath = next();
    else if (arg === '--phase') options.phase = next();
    else if (arg === '--dns-servers-json') options.dnsServersJson = next();
    else if (arg === '--artifact-endpoint-reachable') options.artifactEndpointReachable = next();
    else if (arg === '--openpath-status-json') options.openpathStatusJson = next();
    else if (arg === '--failure-boundary-id') options.failureBoundaryId = next();
    else if (arg === '--failure-boundary-message') options.failureBoundaryMessage = next();
    else if (arg === '--target-url') options.targetUrl = next();
    else if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: node scripts/write-runner-health-evidence.mjs --artifact <path> --phase <id> [options]`
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.phase) {
    throw new Error('--phase is required');
  }

  return options;
}

function parseJsonOption(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readExistingArtifact(path) {
  if (!existsSync(path)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function valueOrNull(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

function buildTarget(options) {
  const refType = process.env.GITHUB_REF_TYPE ?? '';
  return {
    environment: valueOrNull(process.env.TARGET_ENVIRONMENT),
    url: valueOrNull(options.targetUrl || process.env.PRODUCTION_BASE_URL),
    sha: valueOrNull(process.env.GITHUB_SHA),
    tag: refType === 'tag' ? valueOrNull(process.env.GITHUB_REF_NAME) : null,
  };
}

function updateDnsEvidence(evidence, phase, dnsServers) {
  if (!Array.isArray(dnsServers)) {
    return;
  }

  evidence.dns ??= {};
  if (phase === 'pre-reset') evidence.dns.beforeReset = dnsServers;
  else if (phase === 'post-reset') evidence.dns.afterReset = dnsServers;
  else if (phase === 'pre-upload') evidence.dns.beforeUpload = dnsServers;
  else evidence.dns[phase] = dnsServers;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    schemaVersion: 1,
    ...readExistingArtifact(options.artifactPath),
  };

  evidence.runner = {
    name: valueOrNull(process.env.RUNNER_NAME),
    os: valueOrNull(process.env.RUNNER_OS),
  };
  evidence.target = buildTarget(options);
  evidence.updatedAt = new Date().toISOString();
  evidence.phases ??= {};
  evidence.phases[options.phase] = {
    recordedAt: evidence.updatedAt,
    status: 'recorded',
  };

  updateDnsEvidence(evidence, options.phase, parseJsonOption(options.dnsServersJson, null));

  const openpathStatus = parseJsonOption(options.openpathStatusJson, null);
  if (openpathStatus && typeof openpathStatus === 'object') {
    evidence.openpathStatus = openpathStatus;
  }

  if (options.artifactEndpointReachable) {
    evidence.artifactEndpoint ??= {};
    evidence.artifactEndpoint.beforeUpload = {
      host: 'pipelines.actions.githubusercontent.com',
      reachable: options.artifactEndpointReachable === 'true',
    };
  }

  if (options.failureBoundaryId || options.failureBoundaryMessage) {
    evidence.failureBoundary = {
      id: options.failureBoundaryId || 'unknown',
      message: options.failureBoundaryMessage || '',
    };
  }

  writeFileSync(options.artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

main();
