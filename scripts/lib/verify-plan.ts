import { flattenVerifyDomainPolicies, type VerifyFileDomain } from './verify-domain-policy.ts';

export type VerifyMode = 'fast' | 'commit' | 'release';
export type VerifyScope = 'full' | 'ops-regression' | 'release-automation';
export type VerifyE2eDepth = 'skip' | 'commit-smoke' | 'full';
export type VerifyDomainSummary = {
  matchedDomains: string[];
  owners: string[];
  releaseGates: string[];
  requiredApprovals: string[];
  reviewers: string[];
};

export type VerifyPlan = {
  browsersAvailable: boolean;
  composeFile: string;
  composeProjectName: string;
  domainSummary: VerifyDomainSummary;
  e2eDepth: VerifyE2eDepth;
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
  workspaceFingerprint: string;
};

export type { VerifyFileDomain } from './verify-domain-policy.ts';

export const VERIFY_FILE_DOMAINS: VerifyFileDomain[] = flattenVerifyDomainPolicies();

export const RELEASE_AUTOMATION_FILE_PATTERNS = VERIFY_FILE_DOMAINS.filter(
  (domain) => domain.capabilities.releaseAutomationSafe
).map((domain) => domain.pattern);

export function resolveVerifyMode(env: NodeJS.ProcessEnv): VerifyMode {
  if (env.VERIFY_MODE === 'fast') return 'fast';
  return env.VERIFY_MODE === 'release' ? 'release' : 'commit';
}

export function resolveVerifyDomains(filePath: string): VerifyFileDomain[] {
  return VERIFY_FILE_DOMAINS.filter((domain) => domain.pattern.test(filePath));
}

export function summarizeVerifyDomains(stagedFiles: string[]): VerifyDomainSummary {
  const matchedDomains = stagedFiles.flatMap((entry) => resolveVerifyDomains(entry));
  return {
    matchedDomains: [...new Set(matchedDomains.map((domain) => domain.name))],
    owners: [...new Set(matchedDomains.map((domain) => domain.owner))],
    releaseGates: [...new Set(matchedDomains.flatMap((domain) => domain.releaseGates ?? []))],
    requiredApprovals: [
      ...new Set(matchedDomains.flatMap((domain) => domain.requiredApprovals ?? [])),
    ],
    reviewers: [...new Set(matchedDomains.flatMap((domain) => domain.reviewers ?? []))],
  };
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
    if (mode === 'fast' && stagedFiles.length > 0) {
      return detectVerificationScope(stagedFiles, 'commit');
    }
    return 'full';
  }

  const matchedDomains = stagedFiles.flatMap((entry) => resolveVerifyDomains(entry));
  if (
    matchedDomains.length === 0 ||
    matchedDomains.some((domain) => !domain.capabilities.verificationScope)
  ) {
    return 'full';
  }

  const scopes = new Set(
    matchedDomains.map((domain) => domain.capabilities.verificationScope).filter(Boolean)
  );

  if (scopes.size === 1 && scopes.has('release-automation')) {
    return 'release-automation';
  }

  if ([...scopes].every((scope) => scope === 'release-automation' || scope === 'ops-regression')) {
    return scopes.has('ops-regression') ? 'ops-regression' : 'release-automation';
  }

  return 'full';
}

export function detectE2eDepth(mode: VerifyMode): VerifyE2eDepth {
  if (mode === 'release') return 'full';
  if (mode === 'fast') return 'skip';
  return 'commit-smoke';
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
  workspaceFingerprint,
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
  workspaceFingerprint: string;
}): VerifyPlan {
  const { submoduleOnly, skipOpenPathStatic } = detectSubmoduleOnly(stagedFiles);
  const { needsApiCoverage, needsCoverageGate, needsSpaCoverage } =
    detectCoverageNeeds(stagedFiles);

  return {
    browsersAvailable,
    composeFile,
    composeProjectName,
    domainSummary: summarizeVerifyDomains(stagedFiles),
    e2eDepth: detectE2eDepth(mode),
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
    workspaceFingerprint,
  };
}
