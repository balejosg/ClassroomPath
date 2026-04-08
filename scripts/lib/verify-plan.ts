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

type VerifyFileDomain = {
  capabilities: {
    needsCoverage?: 'api' | 'spa';
    releaseAutomationSafe?: boolean;
  };
  name: string;
  pattern: RegExp;
};

export const VERIFY_FILE_DOMAINS: VerifyFileDomain[] = [
  {
    name: 'workflow-definition',
    pattern: /^\.github\/workflows\/.+\.ya?ml$/,
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'root-package-contract',
    pattern: /^package(?:-lock)?\.json$/,
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'release-cli',
    pattern:
      /^scripts\/(?:firefox-release-version|openpath-required-checks|release-images|resolve-latest-verifier-image|run-ci-regression|verify-full|wait-for-release-candidate)\.(?:mjs|ts)$/,
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'release-library',
    pattern:
      /^scripts\/lib\/(?:firefox-release-version|github-actions|openpath-ci-checks|regression-plan|release-candidate|release-images)\.mjs$/,
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'verify-library',
    pattern: /^scripts\/lib\/verify-.+\.ts$/,
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'release-contract-test',
    pattern:
      /^tests\/(?:deployment|firefox-release-version|openpath-required-checks|release-images|verify-plan|verify-report|wait-for-release-candidate|workflow-config)\.test\.ts$/,
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'release-test-helper',
    pattern: /^tests\/helpers\/release-fixtures\.ts$/,
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'release-fixture',
    pattern: /^tests\/fixtures\/release\/.+$/,
    capabilities: { releaseAutomationSafe: true },
  },
  {
    name: 'api-source',
    pattern: /^api\/src\/.*\.(ts|tsx)$/,
    capabilities: { needsCoverage: 'api' },
  },
  {
    name: 'spa-source',
    pattern: /^react-spa\/src\/.*\.(ts|tsx)$/,
    capabilities: { needsCoverage: 'spa' },
  },
];

export const RELEASE_AUTOMATION_FILE_PATTERNS = VERIFY_FILE_DOMAINS.filter(
  (domain) => domain.capabilities.releaseAutomationSafe
).map((domain) => domain.pattern);

export function resolveVerifyMode(env: NodeJS.ProcessEnv): VerifyMode {
  return env.VERIFY_MODE === 'release' ? 'release' : 'commit';
}

export function resolveVerifyDomains(filePath: string): VerifyFileDomain[] {
  return VERIFY_FILE_DOMAINS.filter((domain) => domain.pattern.test(filePath));
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

  const capabilities = stagedFiles.flatMap((entry) =>
    resolveVerifyDomains(entry).map((domain) => domain.capabilities)
  );
  const needsApiCoverage = capabilities.some((capability) => capability.needsCoverage === 'api');
  const needsSpaCoverage = capabilities.some((capability) => capability.needsCoverage === 'spa');

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

  return stagedFiles.every((entry) => {
    const domains = resolveVerifyDomains(entry);
    return (
      domains.length > 0 && domains.every((domain) => domain.capabilities.releaseAutomationSafe)
    );
  })
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
