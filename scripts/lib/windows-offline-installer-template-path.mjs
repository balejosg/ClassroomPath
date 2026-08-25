#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Relative to docker/docker-compose.yml and the deploy preflight's compose cwd.
 * Keep this value in sync with the Compose interpolation contract; deployment
 * tests assert both consumers use the same default.
 */
export const DEFAULT_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR =
  '../var/windows-offline-installer/templates';

export function resolveWindowsOfflineInstallerTemplateDestination(
  env = process.env,
  cwd = process.cwd()
) {
  const configuredRoot =
    env.CP_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR?.trim() ||
    env.CP_OFFLINE_INSTALLER_TEMPLATE_DIR?.trim() ||
    DEFAULT_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR;

  return path.resolve(cwd, configuredRoot);
}

function invokedDirectly() {
  return process.argv[1]
    ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
    : false;
}

if (invokedDirectly()) {
  if (process.argv.includes('--print-host-dir')) {
    const cwdIndex = process.argv.indexOf('--cwd');
    const cwd = cwdIndex >= 0 ? process.argv[cwdIndex + 1] : process.cwd();
    process.stdout.write(
      `${resolveWindowsOfflineInstallerTemplateDestination(process.env, cwd)}\n`
    );
  }
}
