export type VerifyMode = 'commit' | 'release';
export type VerifyScope = 'full' | 'release-automation';

export type VerifyPlan = {
  browsersAvailable: boolean;
  composeFile: string;
  composeProjectName: string;
  mode: VerifyMode;
  needsApiCoverage: boolean;
  needsCoverageGate: boolean;
  needsSpaCoverage: boolean;
  playwrightCacheDir: string;
  playwrightWorkers: number;
  rootDir: string;
  skipOpenPathStatic: boolean;
  stagedFiles: string[];
  submoduleOnly: boolean;
  testDbPort: number;
  verificationScope: VerifyScope;
};

export const RELEASE_AUTOMATION_FILE_PATTERNS = [
  /^\.github\/workflows\/.+\.ya?ml$/,
  /^package(?:-lock)?\.json$/,
  /^scripts\/(?:firefox-release-version|openpath-required-checks|release-images|run-ci-regression|verify-full|wait-for-release-candidate)\.(?:mjs|ts)$/,
  /^scripts\/lib\/(?:firefox-release-version|github-actions|openpath-ci-checks)\.mjs$/,
  /^scripts\/lib\/verify-.+\.ts$/,
  /^tests\/(?:deployment|firefox-release-version|openpath-required-checks|release-images|verify-plan|wait-for-release-candidate|workflow-config)\.test\.ts$/,
  /^tests\/helpers\/release-fixtures\.ts$/,
  /^tests\/fixtures\/release\/.+$/,
];

export function resolveVerifyMode(env: NodeJS.ProcessEnv): VerifyMode {
  return env.VERIFY_MODE === 'release' ? 'release' : 'commit';
}

export function detectSubmoduleOnly(stagedFiles: string[]): {
  submoduleOnly: boolean;
  skipOpenPathStatic: boolean;
} {
  if (stagedFiles.length === 0) {
    return { submoduleOnly: false, skipOpenPathStatic: false };
  }

  const nonSubmoduleFiles = stagedFiles.filter((entry) => entry !== 'upstream/openpath');
  const submoduleOnly = nonSubmoduleFiles.length === 0;

  return {
    submoduleOnly,
    skipOpenPathStatic: submoduleOnly,
  };
}

export function detectCoverageNeeds(stagedFiles: string[]): {
  needsApiCoverage: boolean;
  needsCoverageGate: boolean;
  needsSpaCoverage: boolean;
} {
  if (stagedFiles.length === 0) {
    return {
      needsApiCoverage: true,
      needsCoverageGate: true,
      needsSpaCoverage: true,
    };
  }

  const needsApiCoverage = stagedFiles.some((entry) => /^api\/src\/.*\.(ts|tsx)$/.test(entry));
  const needsSpaCoverage = stagedFiles.some((entry) =>
    /^react-spa\/src\/.*\.(ts|tsx)$/.test(entry)
  );

  return {
    needsApiCoverage,
    needsCoverageGate: needsApiCoverage || needsSpaCoverage,
    needsSpaCoverage,
  };
}

export function detectVerificationScope(stagedFiles: string[], mode: VerifyMode): VerifyScope {
  if (mode !== 'commit' || stagedFiles.length === 0) {
    return 'full';
  }

  return stagedFiles.every((entry) =>
    RELEASE_AUTOMATION_FILE_PATTERNS.some((pattern) => pattern.test(entry))
  )
    ? 'release-automation'
    : 'full';
}

export function createVerifyPlan({
  browsersAvailable,
  composeFile,
  composeProjectName,
  mode,
  playwrightCacheDir,
  playwrightWorkers,
  rootDir,
  stagedFiles,
  testDbPort,
}: {
  browsersAvailable: boolean;
  composeFile: string;
  composeProjectName: string;
  mode: VerifyMode;
  playwrightCacheDir: string;
  playwrightWorkers: number;
  rootDir: string;
  stagedFiles: string[];
  testDbPort: number;
}): VerifyPlan {
  const { submoduleOnly, skipOpenPathStatic } = detectSubmoduleOnly(stagedFiles);
  const { needsApiCoverage, needsCoverageGate, needsSpaCoverage } =
    detectCoverageNeeds(stagedFiles);

  return {
    browsersAvailable,
    composeFile,
    composeProjectName,
    mode,
    needsApiCoverage,
    needsCoverageGate,
    needsSpaCoverage,
    playwrightCacheDir,
    playwrightWorkers,
    rootDir,
    skipOpenPathStatic,
    stagedFiles,
    submoduleOnly,
    testDbPort,
    verificationScope: detectVerificationScope(stagedFiles, mode),
  };
}
