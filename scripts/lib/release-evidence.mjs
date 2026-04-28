// @ts-check

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

function derivePostReleaseCanaryResult({ highRisk, canaryResult }) {
  if (!highRisk) {
    return 'not_applicable';
  }

  const normalized = valueOrNull(canaryResult);
  if (!normalized) {
    return 'pending-post-release';
  }

  if (normalized === 'success') {
    return 'live-tested';
  }

  if (normalized === 'failure') {
    return 'failed';
  }

  if (
    normalized === 'live-tested' ||
    normalized === 'skipped-by-billing-mode' ||
    normalized === 'advisory-only' ||
    normalized === 'failed'
  ) {
    return normalized;
  }

  return normalized;
}

function deriveProductionBootstrapCanaryResult({ highRisk, canaryResult, jobResult }) {
  if (!highRisk) {
    return 'not_applicable';
  }

  const normalizedJobResult = valueOrNull(jobResult);
  if (
    normalizedJobResult &&
    normalizedJobResult !== 'success' &&
    normalizedJobResult !== 'skipped'
  ) {
    return normalizedJobResult;
  }

  return valueOrNull(canaryResult) ?? 'pending-post-release';
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

function derivePromotionEligibility(env) {
  const rawEligible = valueOrNull(env.PROMOTION_ELIGIBLE);
  const fallbackEligible =
    valueOrNull(env.VERIFY_STAGING_RESULT) === 'success' &&
    valueOrNull(env.STAGING_SMOKE_RESULT) === 'success' &&
    valueOrNull(env.STAGING_RELEASE_GATE_RESULT) === 'success';
  const deploymentMode =
    valueOrNull(env.PROMOTION_DEPLOYMENT_MODE) ??
    (valueOrNull(env.STAGING_VERIFIED_IMAGE_SOURCE) === 'source-build'
      ? 'debug'
      : fallbackEligible
        ? 'promotion-eligible'
        : null);

  return {
    status:
      rawEligible === 'true'
        ? 'eligible'
        : rawEligible === 'false'
          ? 'ineligible'
          : fallbackEligible
            ? 'eligible'
            : 'unknown',
    deploymentMode,
  };
}

export function buildReleaseEvidence(env = process.env) {
  const windowsFirefoxHighRisk = isTrueFlag(env.STAGING_WINDOWS_FIREFOX_HIGH_RISK);
  const promotionEligibility = derivePromotionEligibility(env);
  const windowsProductionBootstrapCanary = deriveProductionBootstrapCanaryResult({
    highRisk: windowsFirefoxHighRisk,
    canaryResult: env.WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT,
    jobResult: env.WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT,
  });

  return {
    generatedAt: new Date().toISOString(),
    repository: valueOrNull(env.GITHUB_REPOSITORY),
    workflowRunId: valueOrNull(env.GITHUB_RUN_ID),
    workflowRunUrl:
      valueOrNull(env.GITHUB_SERVER_URL) &&
      valueOrNull(env.GITHUB_REPOSITORY) &&
      valueOrNull(env.GITHUB_RUN_ID)
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
    release: {
      tagName: valueOrNull(env.TAG_NAME),
      classroomPathSha: valueOrNull(env.APP_SHA),
      openPathSha: valueOrNull(env.OPENPATH_SHA),
      outcome: deriveReleaseOutcome({
        deployResult: valueOrNull(env.DEPLOY_RESULT),
        smokeResult: valueOrNull(env.PRODUCTION_SMOKE_RESULT),
        rollbackResult: valueOrNull(env.ROLLBACK_RESULT),
      }),
    },
    promotionEligibility,
    transparency: {
      localVerification: {
        source: 'developer-machine explicit verification',
        reproducedInGitHubActions: false,
        note: 'Pre-commit is a fast local guard; GitHub Actions reuses staging verification evidence for the tagged SHA instead of rerunning the same staging gate during production promotion.',
      },
    },
    targets: {
      staging: {
        publicUrl: valueOrNull(env.STAGING_URL),
        gatewayHealthUrl: valueOrNull(env.STAGING_GATEWAY_HEALTH_URL),
        readyUrl: valueOrNull(env.STAGING_READY_URL),
        apiConfigUrl: valueOrNull(env.STAGING_API_CONFIG_URL),
      },
      production: {
        publicUrl: valueOrNull(env.PRODUCTION_URL),
        gatewayHealthUrl: valueOrNull(env.PRODUCTION_GATEWAY_HEALTH_URL),
        readyUrl: valueOrNull(env.PRODUCTION_READY_URL),
        apiConfigUrl: valueOrNull(env.PRODUCTION_API_CONFIG_URL),
      },
    },
    jobs: {
      verifyOpenPathUpstream: valueOrNull(env.VERIFY_OPENPATH_RESULT),
      resolveReleaseImages: valueOrNull(env.RESOLVE_IMAGES_RESULT),
      verifyStagingReleaseState: valueOrNull(env.VERIFY_STAGING_RESULT),
      windowsFirefoxCanary: deriveAdvisoryCanaryResult({
        highRisk: windowsFirefoxHighRisk,
        canaryResult: env.WINDOWS_FIREFOX_CANARY_RESULT,
      }),
      windowsProductionBootstrapCanary,
      productionClientUpdateCanary: derivePostReleaseCanaryResult({
        highRisk: windowsFirefoxHighRisk,
        canaryResult: env.PRODUCTION_CLIENT_UPDATE_CANARY_RESULT,
      }),
      deployProduction: valueOrNull(env.DEPLOY_RESULT),
      smokeTestProduction: valueOrNull(env.PRODUCTION_SMOKE_RESULT),
      rollbackProduction: valueOrNull(env.ROLLBACK_RESULT),
    },
    diagnostics: {
      windowsProductionBootstrapFailureBoundary: {
        id: valueOrNull(env.WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_ID),
        message: valueOrNull(env.WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE),
      },
    },
    stagingVerification: {
      smokeResult: valueOrNull(env.STAGING_SMOKE_RESULT),
      smokeStatus: valueOrNull(env.STAGING_SMOKE_STATUS),
      releaseGateResult: valueOrNull(env.STAGING_RELEASE_GATE_RESULT),
      windowsFirefoxHighRisk: windowsFirefoxHighRisk ? 'true' : 'false',
      windowsBootstrapResult: valueOrNull(env.STAGING_WINDOWS_BOOTSTRAP_RESULT),
      firefoxPolicyResult: valueOrNull(env.STAGING_FIREFOX_POLICY_RESULT),
      verifiedAt: valueOrNull(env.STAGING_VERIFIED_AT),
    },
    immutableImages: {
      gateway: valueOrNull(env.GATEWAY_IMAGE),
      migrations: valueOrNull(env.MIGRATIONS_IMAGE),
      openPathFirefoxAssets: valueOrNull(env.OPENPATH_FIREFOX_ASSETS_IMAGE),
      openPathApi: valueOrNull(env.OPENPATH_API_IMAGE),
      spa: valueOrNull(env.SPA_IMAGE),
      verifier: valueOrNull(env.VERIFIER_IMAGE),
    },
    artifacts: {
      releaseImageMetadata: valueOrNull(env.TAG_NAME)
        ? `release-image-metadata-${env.TAG_NAME}`
        : null,
      stagingReleaseState: valueOrNull(env.TAG_NAME)
        ? `staging-release-state-${env.TAG_NAME}`
        : null,
      productionSmokeResults: 'smoke-test-results-production',
      windowsProductionBootstrapCanary:
        windowsProductionBootstrapCanary === 'success'
          ? 'windows-production-bootstrap-canary'
          : null,
      releaseEvidence: valueOrNull(env.TAG_NAME)
        ? `release-evidence-${env.TAG_NAME}`
        : 'release-evidence',
    },
  };
}

export function renderReleaseEvidenceMarkdown(evidence) {
  return [
    '## Release Evidence',
    '',
    `- Outcome: \`${evidence.release.outcome}\``,
    `- Tag: \`${evidence.release.tagName ?? 'n/a'}\``,
    `- ClassroomPath SHA: \`${evidence.release.classroomPathSha ?? 'n/a'}\``,
    `- OpenPath SHA: \`${evidence.release.openPathSha ?? 'n/a'}\``,
    `- Promotion eligibility: \`${evidence.promotionEligibility.status}\``,
    `- Deployment mode: \`${evidence.promotionEligibility.deploymentMode ?? 'n/a'}\``,
    evidence.workflowRunUrl ? `- Workflow run: ${evidence.workflowRunUrl}` : '- Workflow run: n/a',
    '',
    '| Gate | Result |',
    '| --- | --- |',
    `| Verify OpenPath upstream | ${evidence.jobs.verifyOpenPathUpstream ?? 'n/a'} |`,
    `| Resolve release images | ${evidence.jobs.resolveReleaseImages ?? 'n/a'} |`,
    `| Verify staging release state | ${evidence.jobs.verifyStagingReleaseState ?? 'n/a'} |`,
    `| Windows/Firefox canary (advisory) | ${evidence.jobs.windowsFirefoxCanary ?? 'n/a'} |`,
    `| Windows production bootstrap canary | ${evidence.jobs.windowsProductionBootstrapCanary ?? 'n/a'} |`,
    `| Production client update canary (post-release) | ${evidence.jobs.productionClientUpdateCanary ?? 'n/a'} |`,
    `| Deploy production | ${evidence.jobs.deployProduction ?? 'n/a'} |`,
    `| Production smoke | ${evidence.jobs.smokeTestProduction ?? 'n/a'} |`,
    `| Rollback | ${evidence.jobs.rollbackProduction ?? 'n/a'} |`,
    '',
    '### Windows Bootstrap Diagnostic Boundary',
    '',
    `- Windows bootstrap failure boundary: \`${evidence.diagnostics.windowsProductionBootstrapFailureBoundary.id ?? 'n/a'}\``,
    `- Boundary message: ${evidence.diagnostics.windowsProductionBootstrapFailureBoundary.message ?? 'n/a'}`,
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
    `- Windows production bootstrap canary: \`${evidence.artifacts.windowsProductionBootstrapCanary ?? 'n/a'}\``,
    `- Release evidence bundle: \`${evidence.artifacts.releaseEvidence ?? 'n/a'}\``,
    '',
    '### Trust Model',
    '',
    '- Local pre-commit is a fast format/secrets guard; `verify:incremental`, `verify:commit`, and release gates provide progressively stronger developer-side evidence.',
    '- Staging records smoke + release-gate evidence for the exact promoted SHA and image digests.',
    '- The Windows/Firefox canary is advisory evidence before deployment; the production client update canary records explicit post-release states on GitHub-hosted Windows and Linux runners.',
    '- GitHub Actions reuses that staging evidence instead of rerunning the same gate during production promotion.',
    '- Canonical public URLs come from `config/deploy-targets.json`.',
    '',
  ].join('\n');
}
