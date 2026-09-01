/**
 * Package manifest for the immutable release-verifier image.
 *
 * This is intentionally data-only so the package checker can run before any
 * release utility is invoked. The paths are image paths, not host checkout
 * paths.
 */

export const RELEASE_VERIFIER_PACKAGE_CONTRACT_VERSION = 1;

export const RELEASE_VERIFIER_REQUIRED_FILES = Object.freeze([
  '/app/scripts/release-bundle.mjs',
  '/app/scripts/release-state-cli.mjs',
  '/app/scripts/release-verifier-package.mjs',
  '/app/scripts/lib/release-bundle.mjs',
  '/app/scripts/lib/openpath-promotion-contract.mjs',
  '/app/scripts/lib/release-bundle-state.mjs',
  '/app/scripts/lib/release-state-contract.mjs',
  '/app/scripts/lib/release-evidence-snapshot.mjs',
  '/app/scripts/lib/release-evidence-contract.mjs',
]);

export const RELEASE_VERIFIER_COMMANDS = Object.freeze([
  Object.freeze({
    name: 'verify-bundle',
    entrypoint: '/app/scripts/release-bundle.mjs',
    invocation: 'verify --bundle-file <file> --contract-file <file>',
  }),
  Object.freeze({
    name: 'project-runtime',
    entrypoint: '/app/scripts/release-bundle.mjs',
    invocation: 'verify --output-env <file>',
  }),
  Object.freeze({
    name: 'read-release-state',
    entrypoint: '/app/scripts/lib/release-bundle-state.mjs',
    invocation: 'read --state-root <dir> --pointer <current|previous>',
  }),
  Object.freeze({
    name: 'write-release-state',
    entrypoint: '/app/scripts/lib/release-bundle-state.mjs',
    invocation: 'persist|activate|capture-previous|activate-previous',
  }),
  Object.freeze({
    name: 'validate-release-state',
    entrypoint: '/app/scripts/release-state-cli.mjs',
    invocation: 'validate --snapshot-type <type>',
  }),
  Object.freeze({
    name: 'rollback-preflight',
    entrypoint: '/app/scripts/lib/release-bundle-state.mjs',
    invocation: 'read --pointer previous',
  }),
]);

export function validateReleaseVerifierPackageFiles(
  availableFiles,
  requiredFiles = RELEASE_VERIFIER_REQUIRED_FILES
) {
  const available = new Set(availableFiles);
  const missing = requiredFiles.filter((file) => !available.has(file));
  return {
    contractVersion: RELEASE_VERIFIER_PACKAGE_CONTRACT_VERSION,
    ok: missing.length === 0,
    missing,
    requiredFiles: [...requiredFiles],
    commands: RELEASE_VERIFIER_COMMANDS.map((command) => ({ ...command })),
  };
}
