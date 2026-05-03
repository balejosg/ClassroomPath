import { resolve } from 'node:path';

const WINDOWS_WORKSPACE = 'C:\\Windows\\Temp\\openpath-ajax-direct';
const OPENPATH_ROOT_ON_WINDOWS = 'C:\\OpenPath';
const DEFAULT_WINDOWS_RUNNER_VMID = '103';
const DEFAULT_PROXMOX_HOST = 'whitelist-proxmox';

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
    source: 'windows/lib/Update.Runtime.psm1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\Update.Runtime.psm1`,
  },
  {
    source: 'windows/lib/internal/Common.Integrity.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\Common.Integrity.ps1`,
  },
  {
    source: 'windows/lib/internal/NativeHost.Actions.ps1',
    destination: `${OPENPATH_ROOT_ON_WINDOWS}\\lib\\internal\\NativeHost.Actions.ps1`,
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
