#!/usr/bin/env node
// @ts-check

/**
 * Verifies that every runtime image listed in a release manifest supports the specified target platform.
 *
 * Invoked by: the `deploy.yml` workflow (`node scripts/verify-release-manifest-platforms.mjs verify`).
 * Usage: node scripts/verify-release-manifest-platforms.mjs verify --manifest-file <path> --target-platform <os/arch[/variant]>
 * Also accepts --manifest-base64; tested by `tests/release-manifest-platforms.test.ts`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { isDirectExecution } from './lib/github-actions.mjs';
import { parseCanonicalReleaseManifestText } from './lib/release-manifest.mjs';
import { parseCommandLine, requireCliOption } from './lib/release-cli.mjs';

const RUNTIME_IMAGE_KEYS = /** @type {const} */ ([
  'gateway_image',
  'migrations_image',
  'openpath_firefox_assets_image',
  'openpath_api_image',
  'spa_image',
  'verifier_image',
]);

/**
 * @param {string} targetPlatform
 * @returns {{ os: string; architecture: string; variant?: string }}
 */
function parseTargetPlatform(targetPlatform) {
  const [os, architecture, variant] = String(targetPlatform ?? '').split('/');
  if (!os || !architecture) {
    throw new Error(`Invalid target platform: ${targetPlatform}`);
  }

  return { os, architecture, variant };
}

/**
 * @param {unknown} platform
 * @param {string} targetPlatform
 * @returns {boolean}
 */
function platformMatchesTarget(platform, targetPlatform) {
  if (!platform || typeof platform !== 'object') {
    return false;
  }

  const target = parseTargetPlatform(targetPlatform);
  const candidate = /** @type {{ os?: unknown; architecture?: unknown; variant?: unknown }} */ (
    platform
  );

  if (candidate.os !== target.os || candidate.architecture !== target.architecture) {
    return false;
  }

  return !target.variant || candidate.variant === target.variant;
}

/**
 * @param {string} manifestText
 * @returns {string[]}
 */
export function listReleaseManifestImages(manifestText) {
  const manifest = parseCanonicalReleaseManifestText(manifestText);
  return RUNTIME_IMAGE_KEYS.map((key) => manifest[key]);
}

/**
 * @param {unknown} imageManifest
 * @param {string} targetPlatform
 * @returns {boolean}
 */
export function manifestSupportsPlatform(imageManifest, targetPlatform) {
  if (!imageManifest || typeof imageManifest !== 'object') {
    return false;
  }

  const manifest =
    /** @type {{ manifests?: unknown; platform?: unknown; os?: unknown; architecture?: unknown; variant?: unknown }} */ (
      imageManifest
    );

  if (Array.isArray(manifest.manifests)) {
    return manifest.manifests.some((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }

      return platformMatchesTarget(
        /** @type {{ platform?: unknown }} */ (entry).platform,
        targetPlatform
      );
    });
  }

  if (manifest.platform) {
    return platformMatchesTarget(manifest.platform, targetPlatform);
  }

  return platformMatchesTarget(
    {
      os: manifest.os,
      architecture: manifest.architecture,
      variant: manifest.variant,
    },
    targetPlatform
  );
}

/**
 * @param {string} image
 * @returns {unknown}
 */
function inspectImageWithDocker(image) {
  const raw = execFileSync('docker', ['buildx', 'imagetools', 'inspect', '--raw', image], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return JSON.parse(raw);
}

/**
 * @param {{
 *   manifestText: string;
 *   targetPlatform: string;
 *   inspectImage?: (image: string) => Promise<unknown> | unknown;
 * }} options
 * @returns {Promise<void>}
 */
export async function verifyReleaseManifestPlatforms({
  manifestText,
  targetPlatform,
  inspectImage = inspectImageWithDocker,
}) {
  parseTargetPlatform(targetPlatform);
  const images = listReleaseManifestImages(manifestText);

  for (const image of images) {
    const inspectedManifest = await inspectImage(image);
    if (!manifestSupportsPlatform(inspectedManifest, targetPlatform)) {
      throw new Error(`Release image ${image} does not support target platform ${targetPlatform}`);
    }
  }
}

function readManifestFromOptions(options) {
  if (options['manifest-file']) {
    return readFileSync(options['manifest-file'], 'utf-8');
  }

  if (options['manifest-base64']) {
    return Buffer.from(options['manifest-base64'], 'base64').toString('utf-8');
  }

  throw new Error('Missing required option --manifest-file or --manifest-base64');
}

async function main(argv) {
  const { command, options } = parseCommandLine(argv, {
    valueFlags: ['--manifest-file', '--manifest-base64', '--target-platform'],
  });

  switch (command) {
    case 'verify': {
      await verifyReleaseManifestPlatforms({
        manifestText: readManifestFromOptions(options),
        targetPlatform: requireCliOption(
          options,
          'target-platform',
          'Missing required option --target-platform'
        ),
      });
      return;
    }
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
