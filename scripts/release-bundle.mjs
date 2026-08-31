#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildReleaseBundle,
  projectReleaseBundleToRuntimeEnv,
  verifyReleaseBundleArtifacts,
  writeReleaseBundleArtifacts,
} from './lib/release-bundle.mjs';

const currentFilePath = fileURLToPath(import.meta.url);

const IMAGE_ENV_KEYS = Object.freeze({
  gateway: 'CLASSROOMPATH_GATEWAY_IMAGE',
  migrations: 'CLASSROOMPATH_MIGRATIONS_IMAGE',
  openpathFirefoxAssets: 'OPENPATH_FIREFOX_ASSETS_IMAGE',
  openpathApi: 'OPENPATH_API_IMAGE',
  spa: 'CLASSROOMPATH_SPA_IMAGE',
  verifier: 'CLASSROOMPATH_VERIFIER_IMAGE',
});

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(name + ' is required');
  return normalized;
}

export function parseReleaseBundleCliArgs(argv = []) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--contract-file' || token === '--bundle-file' || token === '--output-dir') {
      options[token.slice(2).replaceAll('-', '')] = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--classroompath-sha' || token === '--release-id' || token === '--output-env') {
      options[token.slice(2).replaceAll('-', '')] = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--json') {
      options.json = true;
      continue;
    }
    throw new Error('Unknown argument: ' + token);
  }
  return options;
}

function readBuildInputs(options, env) {
  const images = {};
  for (const [name, envName] of Object.entries(IMAGE_ENV_KEYS)) {
    images[name] = required(env[envName], envName);
  }
  return {
    classroomPathSha: required(
      options.classroompathsha || env.APP_SHA || env.GITHUB_SHA,
      'ClassroomPath SHA'
    ),
    images,
  };
}

function writeEnvFile(path, values) {
  const lines = Object.entries(values).map(([key, value]) => key + '=' + value);
  writeFileSync(resolve(path), lines.join('\n') + '\n', 'utf8');
}

export function buildReleaseBundleFromFiles({ options, env = process.env } = {}) {
  const contractPath = required(options.contractfile, '--contract-file');
  const contractBytes = readFileSync(resolve(contractPath));
  const inputs = readBuildInputs(options, env);
  const parsedContract = JSON.parse(contractBytes.toString('utf8'));
  const contractSha256 = createHash('sha256').update(contractBytes).digest('hex');
  const bundle = buildReleaseBundle({
    classroomPathSha: inputs.classroomPathSha,
    openPath: {
      sourceSha: required(parsedContract.openpathSha, 'contract.openpathSha'),
      contractSha256,
    },
    images: inputs.images,
  });
  return { bundle, contractBytes };
}

async function runBuild(options, env) {
  const { bundle, contractBytes } = await buildReleaseBundleFromFiles({ options, env });
  const artifact = writeReleaseBundleArtifacts({
    outputDir: required(options.outputdir, '--output-dir'),
    bundle,
    contractBytes,
  });
  return {
    releaseId: artifact.releaseId,
    bundlePath: artifact.bundlePath,
    contractPath: artifact.contractPath,
    openpathSha: artifact.bundle.openPath.sourceSha,
    contractSha256: artifact.bundle.openPath.contractSha256,
  };
}

function runVerify(options, env) {
  const bundlePath = required(options.bundlefile, '--bundle-file');
  const contractPath = required(options.contractfile, '--contract-file');
  const verified = verifyReleaseBundleArtifacts({
    bundleBytes: readFileSync(resolve(bundlePath)),
    contractBytes: readFileSync(resolve(contractPath)),
    expectedReleaseId: options.releaseid || env.RELEASE_ID || undefined,
    expectedClassroomPathSha:
      options.classroompathsha || env.APP_SHA || env.GITHUB_SHA || undefined,
  });
  if (options.outputenv) {
    writeEnvFile(
      options.outputenv,
      projectReleaseBundleToRuntimeEnv({
        bundle: verified.bundle,
        contract: verified.contract,
        contractSha256: verified.contractSha256,
        releaseId: verified.releaseId,
      })
    );
  }
  return {
    releaseId: verified.releaseId,
    bundlePath: resolve(bundlePath),
    contractPath: resolve(contractPath),
    openpathSha: verified.bundle.openPath.sourceSha,
    contractSha256: verified.bundle.openPath.contractSha256,
  };
}

export async function runReleaseBundleCommand(argv = process.argv.slice(2), env = process.env) {
  const [command, ...commandArgs] = argv;
  const options = parseReleaseBundleCliArgs(commandArgs);
  const result =
    command === 'build'
      ? await runBuild(options, env)
      : command === 'verify'
        ? runVerify(options, env)
        : (() => {
            throw new Error('Unknown release bundle command: ' + command);
          })();
  if (options.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    process.stdout.write(
      Object.entries(result)
        .map(([key, value]) => key + '=' + value)
        .join('\n') + '\n'
    );
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFilePath)) {
  runReleaseBundleCommand().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
