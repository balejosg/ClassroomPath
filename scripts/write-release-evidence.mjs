import { writeFileSync } from 'node:fs';

function valueOrNull(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isTrueFlag(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function deriveAdvisoryCanaryResult({ highRisk, canaryResult }) {
  if (!highRisk) {
    return 'not_applicable';
  }

  return valueOrNull(canaryResult) ?? 'not_run';
}

function deriveReleaseOutcome({ deployResult, smokeResult, rollbackResult }) {
  if (smokeResult === 'success') {
    return 'released';
  }

  if (rollbackResult === 'success') {
    return 'rolled_back_after_failed_smoke';
  }

  if (deployResult === 'failure') {
    return 'deployment_failed';
  }

  if (deployResult === 'success' && smokeResult !== 'success') {
    return 'deployed_without_passing_smoke';
  }

  return 'blocked_before_deploy';
}

const windowsFirefoxHighRisk = isTrueFlag(process.env.STAGING_WINDOWS_FIREFOX_HIGH_RISK);

const evidence = {
  generatedAt: new Date().toISOString(),
  repository: valueOrNull(process.env.GITHUB_REPOSITORY),
  workflowRunId: valueOrNull(process.env.GITHUB_RUN_ID),
  workflowRunUrl:
    valueOrNull(process.env.GITHUB_SERVER_URL) &&
    valueOrNull(process.env.GITHUB_REPOSITORY) &&
    valueOrNull(process.env.GITHUB_RUN_ID)
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
  release: {
    tagName: valueOrNull(process.env.TAG_NAME),
    classroomPathSha: valueOrNull(process.env.APP_SHA),
    openPathSha: valueOrNull(process.env.OPENPATH_SHA),
    outcome: deriveReleaseOutcome({
      deployResult: valueOrNull(process.env.DEPLOY_RESULT),
      smokeResult: valueOrNull(process.env.PRODUCTION_SMOKE_RESULT),
      rollbackResult: valueOrNull(process.env.ROLLBACK_RESULT),
    }),
  },
  transparency: {
    localVerification: {
      source: 'developer-machine pre-commit verify:commit',
      reproducedInGitHubActions: false,
      note: 'GitHub Actions reuses staging verification evidence for the tagged SHA instead of rerunning the same staging gate during production promotion.',
    },
  },
  targets: {
    staging: {
      publicUrl: valueOrNull(process.env.STAGING_URL),
      gatewayHealthUrl: valueOrNull(process.env.STAGING_GATEWAY_HEALTH_URL),
      readyUrl: valueOrNull(process.env.STAGING_READY_URL),
      apiConfigUrl: valueOrNull(process.env.STAGING_API_CONFIG_URL),
    },
    production: {
      publicUrl: valueOrNull(process.env.PRODUCTION_URL),
      gatewayHealthUrl: valueOrNull(process.env.PRODUCTION_GATEWAY_HEALTH_URL),
      readyUrl: valueOrNull(process.env.PRODUCTION_READY_URL),
      apiConfigUrl: valueOrNull(process.env.PRODUCTION_API_CONFIG_URL),
    },
  },
  jobs: {
    verifyOpenPathUpstream: valueOrNull(process.env.VERIFY_OPENPATH_RESULT),
    resolveReleaseImages: valueOrNull(process.env.RESOLVE_IMAGES_RESULT),
    verifyStagingReleaseState: valueOrNull(process.env.VERIFY_STAGING_RESULT),
    windowsFirefoxCanary: deriveAdvisoryCanaryResult({
      highRisk: windowsFirefoxHighRisk,
      canaryResult: process.env.WINDOWS_FIREFOX_CANARY_RESULT,
    }),
    deployProduction: valueOrNull(process.env.DEPLOY_RESULT),
    smokeTestProduction: valueOrNull(process.env.PRODUCTION_SMOKE_RESULT),
    rollbackProduction: valueOrNull(process.env.ROLLBACK_RESULT),
  },
  stagingVerification: {
    smokeResult: valueOrNull(process.env.STAGING_SMOKE_RESULT),
    smokeStatus: valueOrNull(process.env.STAGING_SMOKE_STATUS),
    releaseGateResult: valueOrNull(process.env.STAGING_RELEASE_GATE_RESULT),
    windowsFirefoxHighRisk: windowsFirefoxHighRisk ? 'true' : 'false',
    windowsBootstrapResult: valueOrNull(process.env.STAGING_WINDOWS_BOOTSTRAP_RESULT),
    firefoxPolicyResult: valueOrNull(process.env.STAGING_FIREFOX_POLICY_RESULT),
    verifiedAt: valueOrNull(process.env.STAGING_VERIFIED_AT),
  },
  immutableImages: {
    gateway: valueOrNull(process.env.GATEWAY_IMAGE),
    migrations: valueOrNull(process.env.MIGRATIONS_IMAGE),
    openPathApi: valueOrNull(process.env.OPENPATH_API_IMAGE),
    spa: valueOrNull(process.env.SPA_IMAGE),
    verifier: valueOrNull(process.env.VERIFIER_IMAGE),
  },
  artifacts: {
    releaseImageMetadata: valueOrNull(process.env.TAG_NAME)
      ? `release-image-metadata-${process.env.TAG_NAME}`
      : null,
    stagingReleaseState: valueOrNull(process.env.TAG_NAME)
      ? `staging-release-state-${process.env.TAG_NAME}`
      : null,
    productionSmokeResults: 'smoke-test-results-production',
    releaseEvidence: valueOrNull(process.env.TAG_NAME)
      ? `release-evidence-${process.env.TAG_NAME}`
      : 'release-evidence',
  },
};

const summaryLines = [
  '## Release Evidence',
  '',
  `- Outcome: \`${evidence.release.outcome}\``,
  `- Tag: \`${evidence.release.tagName ?? 'n/a'}\``,
  `- ClassroomPath SHA: \`${evidence.release.classroomPathSha ?? 'n/a'}\``,
  `- OpenPath SHA: \`${evidence.release.openPathSha ?? 'n/a'}\``,
  evidence.workflowRunUrl ? `- Workflow run: ${evidence.workflowRunUrl}` : '- Workflow run: n/a',
  '',
  '| Gate | Result |',
  '| --- | --- |',
  `| Verify OpenPath upstream | ${evidence.jobs.verifyOpenPathUpstream ?? 'n/a'} |`,
  `| Resolve release images | ${evidence.jobs.resolveReleaseImages ?? 'n/a'} |`,
  `| Verify staging release state | ${evidence.jobs.verifyStagingReleaseState ?? 'n/a'} |`,
  `| Windows/Firefox canary (advisory) | ${evidence.jobs.windowsFirefoxCanary ?? 'n/a'} |`,
  `| Deploy production | ${evidence.jobs.deployProduction ?? 'n/a'} |`,
  `| Production smoke | ${evidence.jobs.smokeTestProduction ?? 'n/a'} |`,
  `| Rollback | ${evidence.jobs.rollbackProduction ?? 'n/a'} |`,
  '',
  '### Staging Verification Evidence',
  '',
  `- Smoke result: \`${evidence.stagingVerification.smokeResult ?? 'n/a'}\``,
  `- Smoke status: \`${evidence.stagingVerification.smokeStatus ?? 'n/a'}\``,
  `- Release gate result: \`${evidence.stagingVerification.releaseGateResult ?? 'n/a'}\``,
  `- Windows/Firefox high risk: \`${evidence.stagingVerification.windowsFirefoxHighRisk ?? 'n/a'}\``,
  `- Windows bootstrap result: \`${evidence.stagingVerification.windowsBootstrapResult ?? 'n/a'}\``,
  `- Firefox policy result: \`${evidence.stagingVerification.firefoxPolicyResult ?? 'n/a'}\``,
  `- Verified at: \`${evidence.stagingVerification.verifiedAt ?? 'n/a'}\``,
  '',
  '### Canonical Targets',
  '',
  `- Staging: ${evidence.targets.staging.publicUrl ?? 'n/a'}`,
  `- Production: ${evidence.targets.production.publicUrl ?? 'n/a'}`,
  '',
  '### Immutable Images',
  '',
  `- Gateway: \`${evidence.immutableImages.gateway ?? 'n/a'}\``,
  `- Migrations: \`${evidence.immutableImages.migrations ?? 'n/a'}\``,
  `- OpenPath API: \`${evidence.immutableImages.openPathApi ?? 'n/a'}\``,
  `- SPA: \`${evidence.immutableImages.spa ?? 'n/a'}\``,
  `- Release verifier: \`${evidence.immutableImages.verifier ?? 'n/a'}\``,
  '',
  '### Evidence Artifacts',
  '',
  `- Release image metadata: \`${evidence.artifacts.releaseImageMetadata ?? 'n/a'}\``,
  `- Staging release state + verification: \`${evidence.artifacts.stagingReleaseState ?? 'n/a'}\``,
  `- Production smoke results: \`${evidence.artifacts.productionSmokeResults}\``,
  `- Release evidence bundle: \`${evidence.artifacts.releaseEvidence ?? 'n/a'}\``,
  '',
  '### Trust Model',
  '',
  '- Local `verify:commit` remains the fast developer-side gate.',
  '- Staging records smoke + release-gate evidence for the exact promoted SHA and image digests.',
  '- The Windows/Firefox canary is advisory evidence; it does not block production promotion.',
  '- GitHub Actions reuses that staging evidence instead of rerunning the same gate during production promotion.',
  '- Canonical public URLs come from `config/deploy-targets.json`.',
  '',
];

writeFileSync('release-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
writeFileSync('release-evidence.md', `${summaryLines.join('\n')}\n`, 'utf8');
