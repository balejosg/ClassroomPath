/**
 * Checks that the local git history has sufficient depth for the diff base resolution used by release-risk scripts.
 *
 * Invoked by: Imported by release-risk and release-candidate scripts.
 * Usage: (library module, not invoked directly)
 */
export function isNoMergeBaseError(error) {
  return /no merge base/i.test(String(error?.stderr ?? error?.message ?? error));
}

export function isShallowRepository({ gitOutput, cwd, env = process.env }) {
  try {
    return gitOutput(['rev-parse', '--is-shallow-repository'], { cwd, env }).trim() === 'true';
  } catch {
    return false;
  }
}

export function ensureMergeBaseHistory({
  gitMaybe,
  gitOutput,
  baseRef,
  targetRef,
  cwd,
  env = process.env,
}) {
  if (!baseRef || !targetRef) {
    return;
  }

  if (!isShallowRepository({ gitOutput, cwd, env })) {
    return;
  }

  gitMaybe(['fetch', '--unshallow', '--tags', '--force', 'origin'], { cwd, env });
  gitMaybe(['fetch', '--deepen=200', '--tags', '--force', 'origin'], { cwd, env });
}

export function listChangedFilesMergeBaseSafe({
  gitOutput,
  gitMaybe,
  baseRef,
  targetRef,
  cwd,
  env = process.env,
}) {
  if (!baseRef) {
    return gitOutput(['show', '--pretty=', '--name-only', targetRef], { cwd, env });
  }

  ensureMergeBaseHistory({ gitMaybe, gitOutput, baseRef, targetRef, cwd, env });

  try {
    return gitOutput(['diff', '--name-only', `${baseRef}...${targetRef}`], { cwd, env });
  } catch (error) {
    if (!isNoMergeBaseError(error)) {
      throw error;
    }

    return gitOutput(['diff', '--name-only', baseRef, targetRef], { cwd, env });
  }
}
