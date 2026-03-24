import { writeFileSync } from 'node:fs';

function valueOrNull(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
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
      source: 'developer-machine pre-commit verify:full',
      reproducedInGitHubActions: false,
      note: 'GitHub Actions publishes release evidence for deploy-time gates without duplicating the local fast lane.',
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
    releaseGateStaging: valueOrNull(process.env.RELEASE_GATE_RESULT),
    resolveReleaseImages: valueOrNull(process.env.RESOLVE_IMAGES_RESULT),
    deployProduction: valueOrNull(process.env.DEPLOY_RESULT),
    smokeTestProduction: valueOrNull(process.env.PRODUCTION_SMOKE_RESULT),
    rollbackProduction: valueOrNull(process.env.ROLLBACK_RESULT),
  },
  immutableImages: {
    gateway: valueOrNull(process.env.GATEWAY_IMAGE),
    openPathApi: valueOrNull(process.env.OPENPATH_API_IMAGE),
    spa: valueOrNull(process.env.SPA_IMAGE),
  },
  artifacts: {
    releaseGateResults: 'release-gate-results-staging',
    releaseImageMetadata: valueOrNull(process.env.TAG_NAME)
      ? `release-image-metadata-${process.env.TAG_NAME}`
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
  `| Release gate (staging) | ${evidence.jobs.releaseGateStaging ?? 'n/a'} |`,
  `| Resolve release images | ${evidence.jobs.resolveReleaseImages ?? 'n/a'} |`,
  `| Deploy production | ${evidence.jobs.deployProduction ?? 'n/a'} |`,
  `| Production smoke | ${evidence.jobs.smokeTestProduction ?? 'n/a'} |`,
  `| Rollback | ${evidence.jobs.rollbackProduction ?? 'n/a'} |`,
  '',
  '### Canonical Targets',
  '',
  `- Staging: ${evidence.targets.staging.publicUrl ?? 'n/a'}`,
  `- Production: ${evidence.targets.production.publicUrl ?? 'n/a'}`,
  '',
  '### Immutable Images',
  '',
  `- Gateway: \`${evidence.immutableImages.gateway ?? 'n/a'}\``,
  `- OpenPath API: \`${evidence.immutableImages.openPathApi ?? 'n/a'}\``,
  `- SPA: \`${evidence.immutableImages.spa ?? 'n/a'}\``,
  '',
  '### Evidence Artifacts',
  '',
  `- Release gate results: \`${evidence.artifacts.releaseGateResults}\``,
  `- Release image metadata: \`${evidence.artifacts.releaseImageMetadata ?? 'n/a'}\``,
  `- Production smoke results: \`${evidence.artifacts.productionSmokeResults}\``,
  `- Release evidence bundle: \`${evidence.artifacts.releaseEvidence ?? 'n/a'}\``,
  '',
  '### Trust Model',
  '',
  '- Local `verify:full` remains the fast developer-side gate.',
  '- GitHub Actions adds deploy-time evidence without duplicating the local verification lane.',
  '- Canonical public URLs come from `config/deploy-targets.json`.',
  '',
];

writeFileSync('release-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
writeFileSync('release-evidence.md', `${summaryLines.join('\n')}\n`, 'utf8');
