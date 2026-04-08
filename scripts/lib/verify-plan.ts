import { flattenVerifyDomainPolicies, type VerifyFileDomain } from './verify-domain-policy.ts';

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

export type { VerifyFileDomain } from './verify-domain-policy.ts';

export const VERIFY_FILE_DOMAINS: VerifyFileDomain[] = flattenVerifyDomainPolicies();

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
