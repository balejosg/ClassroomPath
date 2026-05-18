import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const WINDOWS_WORKSPACE = 'C:\\Windows\\Temp\\openpath-ajax-direct';
export const OPENPATH_ROOT_ON_WINDOWS = 'C:\\OpenPath';
const DEFAULT_WINDOWS_RUNNER_VMID = '103';
const DEFAULT_PROXMOX_HOST = 'proxmox-host.example.invalid';

export const WINDOWS_OPENPATH_OVERLAYS = [
  {
    source: 'windows/scripts/Start-SSEListener.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\scripts\\Start-SSEListener.ps1`,
  },
  {
    source: 'windows/scripts/Update-OpenPath.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\scripts\\Update-OpenPath.ps1`,
  },
  {
    source: 'windows/scripts/Apply-RuntimeDependencyQueue.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\scripts\\Apply-RuntimeDependencyQueue.ps1`,
  },
  {
    source: 'windows/scripts/OpenPath-NativeHost.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\scripts\\OpenPath-NativeHost.ps1`,
  },
  {
    source: 'windows/lib/Update.Runtime.psm1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\Update.Runtime.psm1`,
  },
  {
    source: 'windows/lib/Services.psm1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\Services.psm1`,
  },
  {
    source: 'windows/lib/DNS.psm1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\DNS.psm1`,
  },
  {
    source: 'windows/lib/ScriptBootstrap.psm1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\ScriptBootstrap.psm1`,
  },
  {
    source: 'windows/lib/internal/AcrylicConfigWriter.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\AcrylicConfigWriter.ps1`,
  },
  {
    source: 'windows/lib/internal/AcrylicHostsModel.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\AcrylicHostsModel.ps1`,
  },
  {
    source: 'windows/lib/internal/AcrylicHostsRenderer.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\AcrylicHostsRenderer.ps1`,
  },
  {
    source: 'windows/lib/internal/Update.Script.Apply.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\Update.Script.Apply.ps1`,
  },
  {
    source: 'windows/lib/internal/Update.Script.Config.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\Update.Script.Config.ps1`,
  },
  {
    source: 'windows/lib/internal/Update.Script.Rollback.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\Update.Script.Rollback.ps1`,
  },
  {
    source: 'windows/lib/internal/DNS.Acrylic.Install.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\DNS.Acrylic.Install.ps1`,
  },
  {
    source: 'windows/lib/internal/DNS.Acrylic.Config.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\DNS.Acrylic.Config.ps1`,
  },
  {
    source: 'windows/lib/internal/DNS.Acrylic.Service.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\DNS.Acrylic.Service.ps1`,
  },
  {
    source: 'windows/lib/internal/DNS.Diagnostics.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\DNS.Diagnostics.ps1`,
  },
  {
    source: 'windows/lib/internal/Common.Integrity.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\Common.Integrity.ps1`,
  },
  {
    source: 'windows/lib/internal/EndpointPolicyState.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\EndpointPolicyState.ps1`,
  },
  {
    source: 'windows/lib/internal/EndpointStateReconciler.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\EndpointStateReconciler.ps1`,
  },
  {
    source: 'windows/lib/internal/RuntimeDependency.Overlay.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\RuntimeDependency.Overlay.ps1`,
  },
  {
    source: 'windows/lib/internal/RuntimeDependency.Policy.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\RuntimeDependency.Policy.ps1`,
  },
  {
    source: 'windows/lib/internal/RuntimeDependency.Queue.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\RuntimeDependency.Queue.ps1`,
  },
  {
    source: 'windows/lib/internal/ScheduledTaskCatalog.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\ScheduledTaskCatalog.ps1`,
  },
  {
    source: 'windows/lib/internal/Services.TaskBuilders.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\Services.TaskBuilders.ps1`,
  },
  {
    source: 'windows/lib/internal/TaskRunner.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\TaskRunner.ps1`,
  },
  {
    source: 'windows/lib/internal/NativeHost.Actions.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\NativeHost.Actions.ps1`,
  },
  {
    source: 'windows/lib/internal/NativeHost.ArtifactCatalog.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\NativeHost.ArtifactCatalog.ps1`,
  },
  {
    source: 'windows/lib/internal/NativeHost.Protocol.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\NativeHost.Protocol.ps1`,
  },
  {
    source: 'windows/lib/internal/NativeHost.State.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\NativeHost.State.ps1`,
  },
  {
    source: 'windows/scripts/OpenPath-NativeHost.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\browser-extension\\firefox\\native\\OpenPath-NativeHost.ps1`,
  },
  {
    source: 'windows/lib/internal/NativeHost.Actions.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\browser-extension\\firefox\\native\\NativeHost.Actions.ps1`,
  },
];

export const WINDOWS_CANARY_SCRIPT_UPLOADS = [
  {
    source: 'scripts/windows-ajax-auto-allow-canary.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\windows-ajax-auto-allow-canary.mjs`,
  },
  {
    source: 'scripts/lib/windows-ajax-auto-allow-runtime.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\lib\\windows-ajax-auto-allow-runtime.mjs`,
  },
  {
    source: 'scripts/lib/ajax-auto-allow-canary-runtime.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\lib\\ajax-auto-allow-canary-runtime.mjs`,
  },
  {
    source: 'scripts/lib/ajax-auto-allow-canary-harness.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\lib\\ajax-auto-allow-canary-harness.mjs`,
  },
  {
    source: 'scripts/lib/canary-progress.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\lib\\canary-progress.mjs`,
  },
  {
    source: 'scripts/lib/auto-allow-observation.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\lib\\auto-allow-observation.mjs`,
  },
  {
    source: 'scripts/lib/auto-allow-boundary-evidence.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\lib\\auto-allow-boundary-evidence.mjs`,
  },
  {
    source: 'scripts/lib/windows-auto-allow-canary-evidence.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\lib\\windows-auto-allow-canary-evidence.mjs`,
  },
  {
    source: 'scripts/summarize-windows-ajax-auto-allow-evidence.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\summarize-windows-ajax-auto-allow-evidence.mjs`,
  },
];

export function buildRunnerDiagnosticPlan(input) {
  const environment = input.environment ?? 'staging';
  const platform = input.platform;
  const suite = input.suite ?? 'ajax-auto-allow';
  const artifactDir = input.artifactDir;
  if (!platform) throw new Error('platform is required');
  if (!artifactDir) throw new Error('artifactDir is required');

  const plan = {
    platform,
    suite,
    environment,
    baseUrl: input.baseUrl,
    artifactDir,
    safety: {
      confirmProduction: input.confirmProduction === true,
      requiresProductionConfirmation: environment === 'production',
      confirmLocalStateReset: input.confirmLocalStateReset === true,
      requiresLocalStateResetConfirmation: false,
    },
    runnerTarget: {},
    canary: {},
    firefox: {},
    openpathOverlays: [],
    canaryScriptUploads: [],
    artifacts: {},
    environmentVariables: {},
  };

  if (platform === 'windows') {
    plan.runnerTarget = {
      kind: 'proxmox-guest-agent',
      host: input.proxmoxHost ?? DEFAULT_PROXMOX_HOST,
      vmid: input.vmid ?? DEFAULT_WINDOWS_RUNNER_VMID,
      workspace: WINDOWS_WORKSPACE,
    };
    plan.firefox = { mode: input.firefoxMode ?? 'selenium' };
    plan.openpathRoot = input.openpathRoot;
    plan.openpathOverlays = WINDOWS_OPENPATH_OVERLAYS;
    plan.canaryScriptUploads = WINDOWS_CANARY_SCRIPT_UPLOADS;
    plan.canary = {
      command: 'scripts/windows-ajax-auto-allow-canary.mjs',
      remoteScriptPath: `${WINDOWS_WORKSPACE}\\scripts\\windows-ajax-auto-allow-canary.mjs`,
    };
    plan.artifacts = {
      windowsAjaxCanary: resolve(artifactDir, 'production-windows-ajax-auto-allow-canary.json'),
      windowsAjaxSummary: resolve(artifactDir, 'windows-ajax-auto-allow-canary-summary.md'),
      windowsAjaxSummaryOutput: resolve(artifactDir, 'windows-ajax-auto-allow-canary-summary.env'),
    };
    plan.environmentVariables = {
      WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE: plan.firefox.mode,
      WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL: input.baseUrl,
    };
  } else if (platform === 'linux') {
    plan.safety.requiresLocalStateResetConfirmation = true;
    plan.runnerTarget = { kind: 'local-shell' };
    plan.canary = { command: 'scripts/linux-ajax-auto-allow-canary.mjs' };
    plan.artifacts = {
      linuxBootstrapCanary: resolve(artifactDir, 'production-linux-bootstrap-canary.json'),
      linuxBootstrapOutput: resolve(artifactDir, 'production-linux-bootstrap-canary.env'),
      linuxAjaxCanary: resolve(artifactDir, 'production-linux-ajax-auto-allow-canary.json'),
      linuxAjaxSummary: resolve(artifactDir, 'linux-ajax-auto-allow-canary-summary.md'),
      linuxAjaxSummaryOutput: resolve(artifactDir, 'linux-ajax-auto-allow-canary-summary.env'),
      linuxInstaller: resolve(artifactDir, 'install-openpath.sh'),
    };
    plan.environmentVariables = {
      PRODUCTION_LINUX_BOOTSTRAP_CANARY_URL: input.baseUrl,
      PRODUCTION_LINUX_BOOTSTRAP_CANARY_ARTIFACT_PATH: plan.artifacts.linuxBootstrapCanary,
      LINUX_AJAX_AUTO_ALLOW_CANARY_ARTIFACT: plan.artifacts.linuxAjaxCanary,
    };
  } else {
    throw new Error(`Unsupported runner diagnostic platform: ${platform}`);
  }

  return plan;
}

export function validateRunnerDiagnosticPlan(plan) {
  const errors = [];
  if (plan.safety.requiresProductionConfirmation && !plan.safety.confirmProduction) {
    if (plan.platform === 'linux') {
      errors.push('Production Linux AJAX diagnostics require --confirm-production.');
    } else {
      errors.push('Direct production diagnostics require --confirm-production.');
    }
  }
  if (plan.safety.requiresLocalStateResetConfirmation && !plan.safety.confirmLocalStateReset) {
    errors.push(
      'Direct Linux AJAX diagnostics reset local OpenPath state; pass --confirm-local-state-reset.'
    );
  }
  return errors;
}

export function loadRunnerDiagnosticEnvLocal(projectRoot, fileName = '.env.local') {
  const envPath = resolve(projectRoot, fileName);
  if (!existsSync(envPath)) {
    return {};
  }

  const env = {};
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = line.split('=');
    let value = valueParts.join('=').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key.trim()] = value;
  }

  return env;
}

export function readRunnerDiagnosticKeyValueFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || !line.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = line.split('=');
    values[key] = valueParts.join('=');
  }
  return values;
}

export function resolveRunnerDiagnosticBaseUrl({ baseUrl, environment, getDeployTarget }) {
  const rawBaseUrl = baseUrl || getDeployTarget(environment).publicUrl;
  return rawBaseUrl.replace(/\/$/, '');
}

export function resolveRunnerDiagnosticArtifactDir({
  projectRoot,
  artifactDir,
  defaultSubdir,
  environment,
  includeEnvironmentInDefault = false,
  now = new Date(),
}) {
  if (artifactDir) {
    return resolve(projectRoot, artifactDir);
  }

  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const leaf = includeEnvironmentInDefault ? `${environment}-${timestamp}` : timestamp;
  return resolve(projectRoot, '.opencode/tmp', defaultSubdir, leaf);
}

export function summarizeRunnerDiagnosticPlan(plan) {
  const lines = [
    `target_environment=${plan.environment}`,
    `base_url=${plan.baseUrl}`,
    `artifact_dir=${plan.artifactDir}`,
  ];
  if (plan.platform === 'windows') {
    lines.push(`firefox_mode=${plan.firefox.mode}`);
    lines.push(
      `proxmox_guest_agent=ssh ${plan.runnerTarget.host} qm guest exec ${plan.runnerTarget.vmid} -- powershell.exe`
    );
  }
  return lines;
}

export function summarizeRunnerDiagnosticEnvironmentVariables(plan) {
  return Object.entries(plan.environmentVariables ?? {}).map(([key, value]) => `${key}=${value}`);
}

export function buildWindowsAjaxCanaryGuestEnvironment({
  plan,
  summary,
  billingContext,
  canaryTimeoutMs,
  postFailureObservationMs,
  localFirefoxExtension = null,
  redditNavigationMode = 'off',
  redditDiagnosticRetryDelayMs,
  redditNavigationTimeoutMs,
}) {
  const workspace = plan.runnerTarget.workspace ?? WINDOWS_WORKSPACE;
  const blockedRequestDomain = buildWindowsBlockedPageUnblockRequestDomain(summary);
  const environment = {
    OPENPATH_ROOT: OPENPATH_ROOT_ON_WINDOWS,
    WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL: summary.apiUrl ?? plan.baseUrl,
    WINDOWS_AJAX_AUTO_ALLOW_CANARY_GROUP_ID: summary.groupId,
    WINDOWS_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN: billingContext.adminToken,
    WINDOWS_AJAX_AUTO_ALLOW_CANARY_ARTIFACT: `${workspace}\\production-windows-ajax-auto-allow-canary.json`,
    WINDOWS_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS: canaryTimeoutMs,
    WINDOWS_AJAX_AUTO_ALLOW_POST_FAILURE_OBSERVATION_MS: postFailureObservationMs,
    WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE: plan.firefox.mode ?? 'selenium',
    WINDOWS_BLOCKED_PAGE_UNBLOCK_REQUEST_DOMAIN: blockedRequestDomain,
    WINDOWS_AJAX_REDDIT_NAVIGATION_MODE: redditNavigationMode,
    EXPECTED_EXTENSION_ID: summary.extensionId,
  };

  if (redditDiagnosticRetryDelayMs !== undefined) {
    environment.WINDOWS_AJAX_REDDIT_DIAGNOSTIC_RETRY_DELAY_MS = redditDiagnosticRetryDelayMs;
  }
  if (redditNavigationTimeoutMs !== undefined) {
    environment.WINDOWS_AJAX_REDDIT_NAVIGATION_TIMEOUT_MS = redditNavigationTimeoutMs;
  }

  if (localFirefoxExtension?.remotePath) {
    environment.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH = localFirefoxExtension.remotePath;
    if (localFirefoxExtension.version) {
      environment.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_VERSION = localFirefoxExtension.version;
    }
  }

  return environment;
}

export function buildWindowsBlockedPageUnblockRequestDomain(summary = {}) {
  const source = String(summary.classroomId ?? summary.groupId ?? Date.now());
  const suffix =
    source
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'run';
  return `blocked-page-unblock-request-${suffix}.127.0.0.1.sslip.io`;
}

export function buildLinuxAjaxCanaryEnvironment({ plan, groupId, adminToken, extensionId }) {
  return {
    LINUX_AJAX_AUTO_ALLOW_CANARY_API_URL: plan.baseUrl,
    LINUX_AJAX_AUTO_ALLOW_CANARY_GROUP_ID: groupId,
    LINUX_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN: adminToken,
    LINUX_AJAX_AUTO_ALLOW_CANARY_ARTIFACT: plan.artifacts.linuxAjaxCanary,
    EXPECTED_EXTENSION_ID: extensionId,
  };
}

export function emitRunnerDiagnosticEnvironment(
  plan,
  { emit = console.log, prefix = '', environment = plan.environmentVariables } = {}
) {
  for (const [key, value] of Object.entries(environment ?? {})) {
    if (value !== undefined && value !== null) {
      emit(`${prefix}${key}=${value}`);
    }
  }
}

export function uploadRunnerDiagnosticPlanFiles(
  plan,
  { projectRoot, openpathRoot, writeText, sections = ['openpathOverlays', 'canaryScriptUploads'] }
) {
  if (sections.includes('openpathOverlays')) {
    for (const upload of plan.openpathOverlays) {
      writeText(resolve(openpathRoot, upload.source), upload.destination);
    }
  }

  if (sections.includes('canaryScriptUploads')) {
    for (const upload of plan.canaryScriptUploads) {
      writeText(resolve(projectRoot, upload.source), upload.destination);
    }
  }

  if (sections.includes('localInstallerOverlays')) {
    for (const upload of plan.localInstallerOverlays ?? []) {
      writeText(resolve(openpathRoot, upload.source), upload.destination);
    }
  }
}

function runnerDiagnosticSummarySpec(plan) {
  if (plan.platform === 'windows') {
    return {
      script: 'scripts/summarize-windows-ajax-auto-allow-evidence.mjs',
      artifact: plan.artifacts.windowsAjaxCanary,
      summary: plan.artifacts.windowsAjaxSummary,
      output: plan.artifacts.windowsAjaxSummaryOutput,
    };
  }

  if (plan.platform === 'linux') {
    return {
      script: 'scripts/summarize-linux-ajax-auto-allow-evidence.mjs',
      artifact: plan.artifacts.linuxAjaxCanary,
      summary: plan.artifacts.linuxAjaxSummary,
      output: plan.artifacts.linuxAjaxSummaryOutput,
    };
  }

  throw new Error(`Unsupported runner diagnostic platform: ${plan.platform}`);
}

export function summarizeRunnerDiagnosticArtifact(
  plan,
  {
    dryRun = false,
    emit = console.log,
    runCommand,
    nodePath = process.execPath,
    nodeLabel = 'node',
    env = process.env,
    allowFailure = false,
    logDir = '',
    logName = '',
    outputFields = [],
  } = {}
) {
  const spec = runnerDiagnosticSummarySpec(plan);
  const args = [spec.script, '--artifact', spec.artifact, '--summary', spec.summary];

  if (dryRun) {
    emit(`local: ${nodeLabel} ${args.join(' ')}`);
    if (outputFields.length > 0) {
      emit(`local-artifact-fields: ${outputFields.join(' ')}`);
    }
    return undefined;
  }

  if (typeof runCommand !== 'function') {
    throw new Error('runCommand adapter is required to summarize runner diagnostic artifacts');
  }

  return runCommand({
    command: nodePath,
    args,
    env: {
      ...env,
      GITHUB_OUTPUT: spec.output,
    },
    allowFailure,
    logDir,
    logName,
  });
}

export function initializeRunnerDiagnosticRuntime(
  plan,
  {
    dryRun,
    emit = console.log,
    validationErrors = validateRunnerDiagnosticPlan(plan),
    summaryLines = summarizeRunnerDiagnosticPlan(plan),
    summaryLineFilter = () => true,
  } = {}
) {
  if (validationErrors.length > 0) {
    throw new Error(validationErrors[0]);
  }

  for (const line of summaryLines) {
    if (summaryLineFilter(line)) {
      emit(line);
    }
  }

  if (!dryRun) {
    mkdirSync(plan.artifactDir, { recursive: true });
  }
}
