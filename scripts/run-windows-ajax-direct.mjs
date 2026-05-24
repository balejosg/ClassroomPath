#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

import { getDeployTarget } from './deploy-targets.mjs';
import {
  OPENPATH_ROOT_ON_WINDOWS,
  WINDOWS_WORKSPACE,
  buildWindowsAjaxCanaryGuestEnvironment,
  buildRunnerDiagnosticPlan,
  emitRunnerDiagnosticEnvironment,
  initializeRunnerDiagnosticRuntime,
  loadRunnerDiagnosticEnvLocal,
  readRunnerDiagnosticKeyValueFile,
  resolveRunnerDiagnosticArtifactDir,
  resolveRunnerDiagnosticBaseUrl,
  summarizeRunnerDiagnosticArtifact,
  summarizeRunnerDiagnosticPlan,
  uploadRunnerDiagnosticPlanFiles,
  validateRunnerDiagnosticPlan,
} from './lib/runner-diagnostic-execution.mjs';

const DEFAULT_ENVIRONMENT = 'staging';
const DEFAULT_PROXMOX_HOST = 'proxmox-host.example.invalid';
const DEFAULT_WINDOWS_RUNNER_VMID = '';
const DEFAULT_CANARY_TIMEOUT_MS = '180000';
const DEFAULT_POST_FAILURE_OBSERVATION_MS = '60000';
const DEFAULT_FIREFOX_EXTENSION_SOURCE = 'managed';
const DEFAULT_WINDOWS_BOOTSTRAP_SOURCE = 'managed';
const DEFAULT_REDDIT_NAVIGATION_MODE = 'diagnostic';
const DEFAULT_REDDIT_DIAGNOSTIC_RETRY_DELAY_MS = '2500';
const DEFAULT_REDDIT_NAVIGATION_TIMEOUT_MS = '45000';
const DEFAULT_STAGING_REDDIT_EXPLICIT_ALLOWLIST_HOSTS = Object.freeze([
  'reddit.com',
  'www.reddit.com',
  'emoji.redditmedia.com',
  'external-preview.redd.it',
  'i.redd.it',
  'styles.redditmedia.com',
  'www.redditstatic.com',
]);
const LOCAL_FIREFOX_XPI_ON_WINDOWS = `${WINDOWS_WORKSPACE}\\openpath-firefox-extension.xpi`;
const SELENIUM_NODE_MODULES_ZIP_ON_WINDOWS = `${WINDOWS_WORKSPACE}\\selenium-node-modules.zip`;
const WINDOWS_RUNNER_SERVICE_STATE_ON_WINDOWS = `${WINDOWS_WORKSPACE}\\github-runner-services-paused.json`;
const WINDOWS_RUNNER_DNS_REPAIR_SCRIPT = 'scripts/Restore-WindowsRunnerDns.ps1';
const WINDOWS_RUNNER_DNS_REPAIR_SCRIPT_ON_WINDOWS = `${WINDOWS_WORKSPACE}\\Restore-WindowsRunnerDns.ps1`;
const BINARY_UPLOAD_CHUNK_CHARS = 524288;
const DRY_RUN = process.env.WINDOWS_AJAX_DIRECT_DRY_RUN === '1';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');

const SELENIUM_NODE_MODULES = [
  'selenium-webdriver',
  '@bazel/runfiles',
  'jszip',
  'tmp',
  'ws',
  'pako',
  'setimmediate',
  'readable-stream',
  'core-util-is',
  'inherits',
  'isarray',
  'string_decoder',
  'safe-buffer',
  'immediate',
  'lie',
];

function listLocalOpenPathFiles(openpathRoot, relativeDirectory, extensionPattern) {
  const sourceDirectory = resolve(openpathRoot, relativeDirectory);
  if (!existsSync(sourceDirectory)) {
    return [];
  }

  return readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extensionPattern.test(entry.name))
    .map((entry) => `${relativeDirectory}/${entry.name}`);
}

function buildLocalInstallerOverlays(openpathRoot) {
  const packageFiles = [
    'windows/Install-OpenPath.ps1',
    'windows/OpenPath.ps1',
    'windows/Rotate-Token.ps1',
    'windows/runtime/browser-policy-spec.json',
    ...listLocalOpenPathFiles(openpathRoot, 'windows/lib', /\.psm1$/),
    ...listLocalOpenPathFiles(openpathRoot, 'windows/lib/install', /\.ps1$/),
    ...listLocalOpenPathFiles(openpathRoot, 'windows/lib/internal', /\.ps1$/),
    ...listLocalOpenPathFiles(openpathRoot, 'windows/scripts', /\.(?:ps1|cmd)$/),
  ];

  return packageFiles
    .filter((source, index, files) => files.indexOf(source) === index)
    .filter((source) => existsSync(resolve(openpathRoot, source)))
    .map((source) => {
      const packageRelativePath = source.replace(/^windows\//, '').replaceAll('/', '\\');
      return {
        source,
        remote: `${WINDOWS_WORKSPACE}\\local-windows\\${packageRelativePath}`,
        destination: packageRelativePath,
      };
    });
}

function printUsage() {
  console.error(`Usage:
  npm run diagnostics:windows-ajax:direct -- [options]

Options:
  --environment <name>        staging | production (default: ${DEFAULT_ENVIRONMENT})
  --base-url <url>            Public ClassroomPath URL override
  --openpath-root <path>      Local OpenPath checkout (default: ../OpenPath)
  --artifact-dir <path>       Local evidence directory (default: .opencode/tmp/windows-ajax-direct/<timestamp>)
  --proxmox-host <host>       Proxmox SSH host/alias (default: ${DEFAULT_PROXMOX_HOST})
  --vmid <id>                 Windows runner VMID or WINDOWS_RUNNER_VMID env value
  --canary-timeout-ms <ms>    Browser canary timeout (default: ${DEFAULT_CANARY_TIMEOUT_MS})
  --post-failure-observation-ms <ms>
                              Extra local observation window after canary failure (default: ${DEFAULT_POST_FAILURE_OBSERVATION_MS})
  --firefox-extension-source <mode>
                              managed | local (default: ${DEFAULT_FIREFOX_EXTENSION_SOURCE})
  --windows-bootstrap-source <mode>
                              managed | local-installer-runtime (default: ${DEFAULT_WINDOWS_BOOTSTRAP_SOURCE})
  --reddit-navigation-mode <mode>
                              off | diagnostic | gate (default: ${DEFAULT_REDDIT_NAVIGATION_MODE})
  --skip-reset                Do not uninstall the existing OpenPath Windows client before enrollment
  --confirm-production        Required when --environment production
`);
}

function parseArgs(argv) {
  const options = {
    environment: DEFAULT_ENVIRONMENT,
    baseUrl: '',
    openpathRoot: resolve(projectRoot, '..', 'OpenPath'),
    artifactDir: '',
    proxmoxHost:
      process.env.WINDOWS_RUNNER_PROXMOX_HOST ??
      process.env.PROXMOX_SSH_ALIAS ??
      DEFAULT_PROXMOX_HOST,
    vmid: process.env.WINDOWS_RUNNER_VMID ?? DEFAULT_WINDOWS_RUNNER_VMID,
    canaryTimeoutMs: process.env.WINDOWS_AJAX_DIRECT_CANARY_TIMEOUT_MS ?? DEFAULT_CANARY_TIMEOUT_MS,
    postFailureObservationMs:
      process.env.WINDOWS_AJAX_DIRECT_POST_FAILURE_OBSERVATION_MS ??
      DEFAULT_POST_FAILURE_OBSERVATION_MS,
    firefoxExtensionSource:
      process.env.WINDOWS_AJAX_DIRECT_FIREFOX_EXTENSION_SOURCE ?? DEFAULT_FIREFOX_EXTENSION_SOURCE,
    windowsBootstrapSource:
      process.env.WINDOWS_AJAX_DIRECT_WINDOWS_BOOTSTRAP_SOURCE ?? DEFAULT_WINDOWS_BOOTSTRAP_SOURCE,
    redditNavigationMode:
      process.env.WINDOWS_AJAX_REDDIT_NAVIGATION_MODE ?? DEFAULT_REDDIT_NAVIGATION_MODE,
    redditDiagnosticRetryDelayMs:
      process.env.WINDOWS_AJAX_REDDIT_DIAGNOSTIC_RETRY_DELAY_MS ??
      DEFAULT_REDDIT_DIAGNOSTIC_RETRY_DELAY_MS,
    redditNavigationTimeoutMs:
      process.env.WINDOWS_AJAX_REDDIT_NAVIGATION_TIMEOUT_MS ?? DEFAULT_REDDIT_NAVIGATION_TIMEOUT_MS,
    skipReset: false,
    confirmProduction: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--environment') {
      options.environment = next();
    } else if (arg === '--base-url') {
      options.baseUrl = next();
    } else if (arg === '--openpath-root') {
      options.openpathRoot = resolve(projectRoot, next());
    } else if (arg === '--artifact-dir') {
      options.artifactDir = resolve(projectRoot, next());
    } else if (arg === '--proxmox-host') {
      options.proxmoxHost = next();
    } else if (arg === '--vmid') {
      options.vmid = next();
    } else if (arg === '--canary-timeout-ms') {
      options.canaryTimeoutMs = next();
    } else if (arg === '--post-failure-observation-ms') {
      options.postFailureObservationMs = next();
    } else if (arg === '--firefox-extension-source') {
      options.firefoxExtensionSource = next();
    } else if (arg === '--windows-bootstrap-source') {
      options.windowsBootstrapSource = next();
    } else if (arg === '--reddit-navigation-mode') {
      options.redditNavigationMode = next();
    } else if (arg === '--skip-reset') {
      options.skipReset = true;
    } else if (arg === '--confirm-production') {
      options.confirmProduction = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function expandTilde(value) {
  if (!value?.startsWith('~')) {
    return value;
  }

  return resolve(process.env.HOME ?? '', value.slice(2));
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@=+-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

function renderCommand(args) {
  return args.map((arg) => shellQuote(arg)).join(' ');
}

function parseHostList(value) {
  return String(value ?? '')
    .split(/[,\s]+/)
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function resolveRedditExplicitAllowlistHosts(options, env) {
  if (env.WINDOWS_AJAX_REDDIT_EXPLICIT_ALLOWLIST_HOSTS !== undefined) {
    return parseHostList(env.WINDOWS_AJAX_REDDIT_EXPLICIT_ALLOWLIST_HOSTS);
  }

  if (options.environment === 'staging' && options.redditNavigationMode === 'diagnostic') {
    return [...DEFAULT_STAGING_REDDIT_EXPLICIT_ALLOWLIST_HOSTS];
  }

  return [];
}

function psSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function renderPowerShellEnvironment(environment) {
  return Object.entries(environment)
    .map(([key, value]) => `$env:${key} = ${psSingleQuote(value)}`)
    .join('\n');
}

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function ensureFilesExist(options, plan) {
  for (const upload of plan.openpathOverlays) {
    const sourcePath = resolve(options.openpathRoot, upload.source);
    if (!existsSync(sourcePath)) {
      throw new Error(`Required OpenPath overlay is missing: ${sourcePath}`);
    }
  }

  for (const upload of plan.canaryScriptUploads) {
    const sourcePath = resolve(projectRoot, upload.source);
    if (!existsSync(sourcePath)) {
      throw new Error(`Required canary helper is missing: ${sourcePath}`);
    }
  }

  for (const moduleName of SELENIUM_NODE_MODULES) {
    const modulePath = resolve(projectRoot, 'node_modules', moduleName);
    if (!existsSync(modulePath)) {
      throw new Error(
        `Required local Selenium dependency is missing: ${modulePath}. Run npm install in ClassroomPath first.`
      );
    }
  }

  if (options.firefoxExtensionSource === 'local') {
    for (const relativePath of [
      'package.json',
      'firefox-extension/manifest.json',
      'firefox-extension/build-xpi.sh',
    ]) {
      const sourcePath = resolve(options.openpathRoot, relativePath);
      if (!existsSync(sourcePath)) {
        throw new Error(`Required local Firefox extension file is missing: ${sourcePath}`);
      }
    }
  }

  if (options.windowsBootstrapSource === 'local-installer-runtime') {
    const localInstallerOverlays = buildLocalInstallerOverlays(options.openpathRoot);
    for (const requiredDestination of [
      'Install-OpenPath.ps1',
      'lib\\install\\Installer.Dns.ps1',
      'lib\\internal\\CapabilityStorage.ps1',
    ]) {
      if (!localInstallerOverlays.some((overlay) => overlay.destination === requiredDestination)) {
        throw new Error(
          `Required local Windows installer overlay is missing: ${requiredDestination}`
        );
      }
    }
    for (const overlay of localInstallerOverlays) {
      const sourcePath = resolve(options.openpathRoot, overlay.source);
      if (!existsSync(sourcePath)) {
        throw new Error(`Required local Windows installer file is missing: ${sourcePath}`);
      }
    }
  } else if (options.windowsBootstrapSource !== 'managed') {
    throw new Error(
      `Unsupported Windows bootstrap source: ${options.windowsBootstrapSource}. Expected managed or local-installer-runtime.`
    );
  }
}

function runCommand(args, { cwd = projectRoot, env = process.env, input, capture = false } = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf8',
    env,
    input,
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
  });

  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
    throw new Error(
      `${renderCommand(args)} failed with exit code ${result.status ?? 'unknown'}${stderr}`
    );
  }

  return capture ? result.stdout.trim() : '';
}

function runGuestCommand(options, guestArgs, { input, capture = true } = {}) {
  const effectiveGuestArgs = input === undefined ? guestArgs : ['--pass-stdin', '1', ...guestArgs];
  const remoteCommand = renderCommand(['qm', 'guest', 'exec', options.vmid, ...effectiveGuestArgs]);
  const args = ['ssh', options.proxmoxHost, remoteCommand];

  if (DRY_RUN) {
    const encodedCommandIndex = effectiveGuestArgs.indexOf('-EncodedCommand');
    const previewGuestArgs =
      encodedCommandIndex === -1
        ? effectiveGuestArgs
        : [...effectiveGuestArgs.slice(0, encodedCommandIndex + 1), '<encoded>'];
    console.log(
      renderCommand([
        'ssh',
        options.proxmoxHost,
        renderCommand(['qm', 'guest', 'exec', options.vmid, ...previewGuestArgs]),
      ])
    );
    return '';
  }

  const output = runCommand(args, { input, capture });
  if (!capture) {
    return '';
  }

  const payload = JSON.parse(output);
  if (payload.exitcode !== 0 || payload.exited !== 1) {
    throw new Error(
      `Guest command failed with exit code ${payload.exitcode ?? 'unknown'}: ${payload['err-data'] ?? payload['out-data'] ?? ''}`
    );
  }

  return payload['out-data'] ?? '';
}

function runGuestPowerShell(options, script, { input, timeoutSeconds = 600 } = {}) {
  return runGuestCommand(
    options,
    [
      '--timeout',
      String(timeoutSeconds),
      '--',
      'powershell.exe',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodePowerShell(script),
    ],
    { input }
  );
}

function buildGuestStdinExactReadScript(expectedInputChars) {
  return `
function Read-GuestStdinExact {
  param([int]$ExpectedChars)
  $buffer = New-Object char[] $ExpectedChars
  $offset = 0
  while ($offset -lt $ExpectedChars) {
    $read = [Console]::In.Read($buffer, $offset, $ExpectedChars - $offset)
    if ($read -le 0) {
      throw "Guest stdin ended after $offset of $ExpectedChars characters"
    }
    $offset += $read
  }
  return -join $buffer
}
$content = Read-GuestStdinExact -ExpectedChars ${expectedInputChars}
`;
}

function writeGuestText(options, localSourcePath, destinationPath) {
  const content = readFileSync(localSourcePath, 'utf8');
  const script = `
$ErrorActionPreference = 'Stop'
$path = ${psSingleQuote(destinationPath)}
$parent = Split-Path -Parent $path
New-Item -ItemType Directory -Force -Path $parent | Out-Null
${buildGuestStdinExactReadScript(content.length)}
[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
`;

  if (DRY_RUN) {
    console.log(`guest-upload: ${localSourcePath} -> ${destinationPath}`);
  }

  runGuestPowerShell(options, script, { input: content });
}

function writeGuestBinary(options, localSourcePath, destinationPath) {
  const initializeScript = `
$ErrorActionPreference = 'Stop'
$path = ${psSingleQuote(destinationPath)}
$parent = Split-Path -Parent $path
New-Item -ItemType Directory -Force -Path $parent | Out-Null
[System.IO.File]::WriteAllBytes($path, [byte[]]::new(0))
`;
  const appendScript = `
$ErrorActionPreference = 'Stop'
$path = ${psSingleQuote(destinationPath)}
__READ_STDIN_EXACT__
$bytes = [Convert]::FromBase64String($content)
$stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write)
try {
  $stream.Write($bytes, 0, $bytes.Length)
} finally {
  $stream.Dispose()
}
`;

  if (DRY_RUN) {
    console.log(`guest-upload-binary: ${localSourcePath} -> ${destinationPath}`);
    runGuestPowerShell(options, initializeScript);
    runGuestPowerShell(options, appendScript, { input: '<base64-chunk>' });
    return;
  }

  const base64 = readFileSync(localSourcePath).toString('base64');
  runGuestPowerShell(options, initializeScript);
  for (let offset = 0; offset < base64.length; offset += BINARY_UPLOAD_CHUNK_CHARS) {
    const chunk = base64.slice(offset, offset + BINARY_UPLOAD_CHUNK_CHARS);
    runGuestPowerShell(
      options,
      appendScript.replace('__READ_STDIN_EXACT__', buildGuestStdinExactReadScript(chunk.length)),
      {
        input: chunk,
      }
    );
  }
}

function readGuestText(options, sourcePath, maxChars = 200000) {
  const script = `
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
$path = ${psSingleQuote(sourcePath)}
if (-not (Test-Path -LiteralPath $path)) { exit 0 }
$content = Get-Content -LiteralPath $path -Raw
if ($content.Length -gt ${maxChars}) {
  $content.Substring($content.Length - ${maxChars})
} else {
  $content
}
`;
  return runGuestPowerShell(options, script, { timeoutSeconds: 120 });
}

function readGuestFileUtf8(options, sourcePath) {
  const script = `
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
$path = ${psSingleQuote(sourcePath)}
if (-not (Test-Path -LiteralPath $path)) { exit 0 }
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes($path))
`;
  const output = runGuestPowerShell(options, script, { timeoutSeconds: 120 }).trim();
  if (!output) {
    return '';
  }

  return Buffer.from(output.replace(/\s+/g, ''), 'base64').toString('utf8');
}

function buildDnsBootstrapScript(baseUrl) {
  const hostname = new URL(baseUrl).hostname;
  if (isIP(hostname) !== 0) {
    return `
Write-Host ${psSingleQuote(`Skipping DNS lookup for literal IP target ${hostname}`)}
function Repair-OpenPathTargetDns { return }
function Invoke-OpenPathWebRequestWithDnsRecovery {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [hashtable]$Headers,
    [Parameter(Mandatory = $true)][string]$OutFile
  )
  Invoke-WebRequest -Uri $Uri -Headers $Headers -OutFile $OutFile
}
`;
  }
  return `
$targetHost = ${psSingleQuote(hostname)}
$dnsRepairScript = ${psSingleQuote(WINDOWS_RUNNER_DNS_REPAIR_SCRIPT_ON_WINDOWS)}

function Test-OpenPathTargetDns($label) {
  try {
    Resolve-DnsName -Name $targetHost -Type A -QuickTimeout -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -First 1 | Out-Null
    [System.Net.Dns]::GetHostAddresses($targetHost) | Select-Object -First 1 | Out-Null
    Write-Host "$label DNS configuration can resolve $targetHost"
    return $true
  } catch {
    Write-Host "$label DNS configuration cannot resolve \${targetHost}: $($_.Exception.Message)"
    return $false
  }
}

function Repair-OpenPathTargetDns {
  if (Test-OpenPathTargetDns 'Existing') { return }
  if (-not (Test-Path -LiteralPath $dnsRepairScript)) {
    throw "Windows runner DNS repair script is missing: $dnsRepairScript"
  }
  & $dnsRepairScript -DnsServers @('1.1.1.1', '8.8.8.8') -ConnectivityHosts @($targetHost) -RequireConnectivity $false
  if (-not (Test-OpenPathTargetDns 'Repaired')) {
    throw "Unable to resolve $targetHost after DNS repair"
  }
}

function Invoke-OpenPathWebRequestWithDnsRecovery {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [hashtable]$Headers,
    [Parameter(Mandatory = $true)][string]$OutFile
  )
  $lastError = $null
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    try {
      Invoke-WebRequest -Uri $Uri -Headers $Headers -OutFile $OutFile
      return
    } catch {
      $lastError = $_
      $message = [string]$_.Exception.Message
      if ($message -notmatch 'remote name could not be resolved|name resolution|NameResolutionFailure|No such host') {
        throw
      }
      Write-Host "Download attempt $attempt failed due to DNS: $message"
      if ($attempt -ge 2) { break }
      Repair-OpenPathTargetDns
      Start-Sleep -Seconds 2
    }
  }
  throw $lastError
}

Repair-OpenPathTargetDns
`;
}

function camelFromSnake(value) {
  return value.replace(/_([a-z])/g, (_, character) => character.toUpperCase());
}

function redactProvisionOutputs(outputs) {
  return Object.fromEntries(
    Object.entries(outputs).map(([key, value]) => [
      key,
      key.includes('token') && value ? '[redacted]' : value,
    ])
  );
}

function resolveRemoteAccess(environment, env) {
  if (environment === 'staging') {
    return {
      host: env.STAGING_HOST ?? 'staging-host.example.invalid',
      user: env.STAGING_USER ?? 'deploy',
      port: env.STAGING_PORT ?? '22',
      key: expandTilde(env.STAGING_SSH_KEY ?? ''),
    };
  }

  const deployHost = env.DEPLOY_HOST ?? new URL(getDeployTarget('production').publicUrl).hostname;
  return {
    host: deployHost,
    user: env.DEPLOY_USER ?? 'deploy',
    port: env.DEPLOY_PORT ?? '22',
    key: expandTilde(env.DEPLOY_SSH_KEY ?? `${process.env.HOME}/.ssh/classroompath_deploy`),
  };
}

function readRemoteEnvKey(access, key) {
  if (!access.key || !existsSync(access.key)) {
    throw new Error(`SSH key is required to read ${key} from the target host`);
  }

  const remote = `grep '^${key}=' /srv/classroompath/app/config/.env | sed 's/^${key}=//' | head -n1`;
  return runCommand(
    [
      'ssh',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-i',
      access.key,
      '-p',
      access.port,
      `${access.user}@${access.host}`,
      remote,
    ],
    { capture: true }
  ).trim();
}

function resolveBillingContext(options, env) {
  if (DRY_RUN) {
    return {
      billingMode: 'manual_only',
      adminToken: '<target CP_CLIENT_CANARY_ADMIN_TOKEN>',
      stripeWebhookSecret: '',
    };
  }

  const access = resolveRemoteAccess(options.environment, env);
  const billingMode =
    env.PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_BILLING_MODE ||
    readRemoteEnvKey(access, 'CP_BILLING_MODE') ||
    'manual_only';

  if (billingMode === 'manual_only') {
    const adminToken =
      env.PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ADMIN_TOKEN ||
      readRemoteEnvKey(access, 'CP_CLIENT_CANARY_ADMIN_TOKEN');
    if (!adminToken) {
      throw new Error(`CP_CLIENT_CANARY_ADMIN_TOKEN is missing for ${options.environment}`);
    }
    return { billingMode, adminToken, stripeWebhookSecret: '' };
  }

  if (billingMode === 'stripe') {
    const stripeWebhookSecret =
      env.PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET ||
      readRemoteEnvKey(access, 'STRIPE_WEBHOOK_SECRET');
    if (!stripeWebhookSecret) {
      throw new Error(`STRIPE_WEBHOOK_SECRET is missing for ${options.environment}`);
    }
    let adminToken = env.PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ADMIN_TOKEN || '';
    try {
      adminToken = adminToken || readRemoteEnvKey(access, 'CP_CLIENT_CANARY_ADMIN_TOKEN');
    } catch {
      adminToken = '';
    }
    return { billingMode, adminToken, stripeWebhookSecret };
  }

  throw new Error(`Unsupported CP_BILLING_MODE for ${options.environment}: ${billingMode}`);
}

function provisionCanary({ options, baseUrl, artifactDir, billingContext, env }) {
  const outputPath = resolve(artifactDir, 'provision-outputs.env');
  const canaryArtifactPath = resolve(artifactDir, 'production-windows-bootstrap-canary.json');
  const redditExplicitAllowlistHosts = resolveRedditExplicitAllowlistHosts(options, env);
  const provisionEnv = {
    ...env,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_URL: baseUrl,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_REQUEST_ORIGIN: new URL(baseUrl).origin,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ARTIFACT_PATH: canaryArtifactPath,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_BILLING_MODE: billingContext.billingMode,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ADMIN_TOKEN: billingContext.adminToken,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET: billingContext.stripeWebhookSecret,
    GITHUB_OUTPUT: outputPath,
  };
  if (redditExplicitAllowlistHosts.length > 0) {
    provisionEnv.WINDOWS_AJAX_REDDIT_EXPLICIT_ALLOWLIST_HOSTS =
      redditExplicitAllowlistHosts.join(',');
  }

  if (DRY_RUN) {
    if (provisionEnv.WINDOWS_AJAX_REDDIT_EXPLICIT_ALLOWLIST_HOSTS) {
      console.log(
        `local-env: WINDOWS_AJAX_REDDIT_EXPLICIT_ALLOWLIST_HOSTS=${provisionEnv.WINDOWS_AJAX_REDDIT_EXPLICIT_ALLOWLIST_HOSTS}`
      );
    }
    console.log(
      `local: PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_URL=${baseUrl} node scripts/create-production-windows-bootstrap-canary.mjs`
    );
    return {
      apiUrl: baseUrl,
      classroomId: '<classroom-id>',
      groupId: '<group-id>',
      enrollmentToken: '<enrollment-token>',
      publicFirefoxXpiUrl: `${baseUrl}/api/extensions/firefox/openpath.xpi`,
      extensionId: 'monitor-bloqueos@openpath',
      extensionVersion: '<extension-version>',
    };
  }

  runCommand([process.execPath, 'scripts/create-production-windows-bootstrap-canary.mjs'], {
    env: provisionEnv,
  });

  const outputs = readRunnerDiagnosticKeyValueFile(outputPath);
  const summary = Object.fromEntries(
    Object.entries(outputs).map(([key, value]) => [camelFromSnake(key), value])
  );

  writeFileSync(
    resolve(artifactDir, 'provision-outputs.redacted.json'),
    `${JSON.stringify(redactProvisionOutputs(outputs), null, 2)}\n`,
    'utf8'
  );

  if (!summary.enrollmentToken || !summary.classroomId || !summary.groupId) {
    throw new Error(
      'Canary provisioning did not return classroom_id, group_id, and enrollment_token'
    );
  }

  return summary;
}

function installWindowsClient(options, summary) {
  uploadWindowsRunnerDnsRepairScript(options);

  const localInstallerOverlays =
    options.windowsBootstrapSource === 'local-installer-runtime'
      ? buildLocalInstallerOverlays(options.openpathRoot)
      : [];
  if (localInstallerOverlays.length > 0) {
    uploadRunnerDiagnosticPlanFiles(
      {
        localInstallerOverlays: localInstallerOverlays.map((overlay) => ({
          source: overlay.source,
          destination: overlay.remote,
        })),
      },
      {
        projectRoot,
        openpathRoot: options.openpathRoot,
        sections: ['localInstallerOverlays'],
        writeText: (sourcePath, destinationPath) =>
          writeGuestText(options, sourcePath, destinationPath),
      }
    );
  }
  const patchLocalInstallerRuntime = localInstallerOverlays.length
    ? `
$wrapperContent = Get-Content -LiteralPath $windowsScriptPath -Raw
$patch = @'
if (Test-Path -LiteralPath '${WINDOWS_WORKSPACE}\\local-windows') {
  Copy-Item -Path '${WINDOWS_WORKSPACE}\\local-windows\\*' -Destination $WindowsRoot -Recurse -Force
}
'@
$wrapperContent = $wrapperContent -replace 'Push-Location \\$WindowsRoot', ($patch + [Environment]::NewLine + 'Push-Location $WindowsRoot')
Set-Content -LiteralPath $windowsScriptPath -Value $wrapperContent -Encoding UTF8
`
    : '';
  const script = `
$ErrorActionPreference = 'Stop'
${buildDnsBootstrapScript(summary.apiUrl)}
$workspace = ${psSingleQuote(WINDOWS_WORKSPACE)}
New-Item -ItemType Directory -Force -Path $workspace | Out-Null

$headers = @{ Authorization = ${psSingleQuote(`Bearer ${summary.enrollmentToken}`)} }
$windowsScriptUrl = ${psSingleQuote(summary.windowsScriptUrl ?? `${summary.apiUrl}/api/enroll/${summary.classroomId}/windows.ps1`)}
$windowsScriptPath = Join-Path $workspace 'windows.ps1'

Invoke-OpenPathWebRequestWithDnsRecovery -Uri $windowsScriptUrl -Headers $headers -OutFile $windowsScriptPath
${patchLocalInstallerRuntime}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $windowsScriptPath
if ($LASTEXITCODE -ne 0) {
  throw "windows.ps1 exited with code $LASTEXITCODE"
}
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 1200 });
}

function uploadWindowsRunnerDnsRepairScript(options) {
  writeGuestText(
    options,
    resolve(projectRoot, WINDOWS_RUNNER_DNS_REPAIR_SCRIPT),
    WINDOWS_RUNNER_DNS_REPAIR_SCRIPT_ON_WINDOWS
  );
}

function buildLocalCanaryFirefoxVersion() {
  return `9999.${Math.floor(Date.now() / 1000)}.0`;
}

async function writeLocalFirefoxCanaryXpi(sourceXpiPath, destinationXpiPath) {
  const zip = await JSZip.loadAsync(readFileSync(sourceXpiPath));
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error(`Local Firefox extension XPI is missing manifest.json: ${sourceXpiPath}`);
  }

  const manifest = JSON.parse(await manifestFile.async('string'));
  const version = buildLocalCanaryFirefoxVersion();
  manifest.version = version;
  zip.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(destinationXpiPath, await zip.generateAsync({ type: 'nodebuffer' }));
  return version;
}

async function buildLocalFirefoxExtension(options, artifactDir) {
  if (options.firefoxExtensionSource !== 'local') {
    return null;
  }

  const extensionRoot = resolve(options.openpathRoot, 'firefox-extension');
  const localXpiPath = resolve(artifactDir, 'openpath-firefox-extension.xpi');

  if (DRY_RUN) {
    console.log('local: npm run build --workspace=@openpath/firefox-extension');
    console.log(`local: bash ${resolve(extensionRoot, 'build-xpi.sh')}`);
    return {
      localPath: localXpiPath,
      remotePath: LOCAL_FIREFOX_XPI_ON_WINDOWS,
      version: 'dry-run',
    };
  }

  mkdirSync(artifactDir, { recursive: true });
  runCommand(['npm', 'run', 'build', '--workspace=@openpath/firefox-extension'], {
    cwd: options.openpathRoot,
  });
  runCommand(['bash', 'firefox-extension/build-xpi.sh'], { cwd: options.openpathRoot });

  const manifest = JSON.parse(readFileSync(resolve(extensionRoot, 'manifest.json'), 'utf8'));
  const version = manifest?.version;
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error('Firefox extension manifest version is missing');
  }

  const builtXpiPath = resolve(extensionRoot, `monitor-bloqueos-red-${version}.xpi`);
  if (!existsSync(builtXpiPath)) {
    throw new Error(`Local Firefox extension XPI was not produced: ${builtXpiPath}`);
  }

  const versionOverride = await writeLocalFirefoxCanaryXpi(builtXpiPath, localXpiPath);
  return {
    localPath: localXpiPath,
    remotePath: LOCAL_FIREFOX_XPI_ON_WINDOWS,
    version: versionOverride,
  };
}

function buildSeleniumNodeModulesBundle(options, artifactDir) {
  const localPath = resolve(artifactDir, 'selenium-node-modules.zip');
  if (DRY_RUN) {
    console.log(`local: zip ${localPath} ${SELENIUM_NODE_MODULES.join(' ')}`);
    return {
      localPath,
      remotePath: SELENIUM_NODE_MODULES_ZIP_ON_WINDOWS,
    };
  }

  mkdirSync(artifactDir, { recursive: true });
  rmSync(localPath, { force: true });
  runCommand(
    [
      'zip',
      '-qr',
      localPath,
      ...SELENIUM_NODE_MODULES.map((moduleName) => `node_modules/${moduleName}`),
    ],
    { cwd: projectRoot }
  );

  return {
    localPath,
    remotePath: SELENIUM_NODE_MODULES_ZIP_ON_WINDOWS,
  };
}

function ensureSeleniumFirefoxCanarySupport(options) {
  const requireUnsignedAddonChannel = options.firefoxExtensionSource === 'local';
  const script = `
$ErrorActionPreference = 'Stop'
$workspace = ${psSingleQuote(WINDOWS_WORKSPACE)}
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
$zipPath = ${psSingleQuote(SELENIUM_NODE_MODULES_ZIP_ON_WINDOWS)}
$seleniumModule = Join-Path $workspace 'node_modules\\selenium-webdriver'
if (-not (Test-Path -LiteralPath $seleniumModule)) {
  if (-not (Test-Path -LiteralPath $zipPath)) {
    throw "Selenium node_modules bundle missing: $zipPath"
  }
  Expand-Archive -LiteralPath $zipPath -DestinationPath $workspace -Force
}
if (-not (Test-Path -LiteralPath $seleniumModule)) {
  throw "Selenium node_modules bundle did not create $seleniumModule"
}
$gecko = (Get-Command geckodriver.exe -ErrorAction SilentlyContinue).Source
if (-not $gecko -and (Test-Path -LiteralPath 'C:\\tools\\selenium\\geckodriver.exe')) {
  $gecko = 'C:\\tools\\selenium\\geckodriver.exe'
}
if (-not $gecko) {
  if (-not (Get-Command choco.exe -ErrorAction SilentlyContinue)) {
    throw 'geckodriver.exe is required for local Firefox extension diagnostics and Chocolatey is not available to install it'
  }
  choco install geckodriver --no-progress -y
  $gecko = (Get-Command geckodriver.exe -ErrorAction SilentlyContinue).Source
}
if (-not $gecko) {
  throw 'geckodriver.exe is required for Firefox extension diagnostics'
}
if (${requireUnsignedAddonChannel ? '$false' : '$true'}) {
  $firefoxReleaseCandidates = @(
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
  )
  $firefoxRelease = $firefoxReleaseCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $firefoxRelease) {
    throw 'Firefox Release is required for managed signed extension diagnostics'
  }
}
if (${requireUnsignedAddonChannel ? '$false' : '$true'}) { return }
$firefoxDevCandidates = @(
  'C:\\Program Files\\Firefox Developer Edition\\firefox.exe',
  'C:\\Program Files\\Firefox Nightly\\firefox.exe'
)
$firefoxDev = $firefoxDevCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $firefoxDev) {
  if (-not (Get-Command choco.exe -ErrorAction SilentlyContinue)) {
    throw 'Firefox Developer Edition or Nightly is required for unsigned local extension diagnostics and Chocolatey is not available to install it'
  }
  choco install firefox-dev --pre --no-progress -y
  $firefoxDev = $firefoxDevCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $firefoxDev) {
  choco install firefox-nightly --pre --no-progress -y
  $firefoxDev = $firefoxDevCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $firefoxDev) {
  throw 'Firefox Developer Edition or Nightly is required for unsigned local extension diagnostics'
}
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 900 });
}

function resetWindowsClient(options, baseUrl) {
  const script = `
$ErrorActionPreference = 'Continue'
Get-ScheduledTask -TaskName 'OpenPath-*' -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
if (Test-Path 'C:\\OpenPath\\Uninstall-OpenPath.ps1') {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\\OpenPath\\Uninstall-OpenPath.ps1'
}
${buildDnsBootstrapScript(baseUrl)}
Remove-Item ${psSingleQuote(WINDOWS_WORKSPACE)} -Recurse -Force -ErrorAction SilentlyContinue
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 600 });
}

function verifyWindowsPreflight(options) {
  const script = `
$ErrorActionPreference = 'Stop'
hostname
whoami
node --version
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 120 });
}

function assertWindowsRunnerExecutionIdle(options, context) {
  const script = `
$ErrorActionPreference = 'Stop'
$context = ${psSingleQuote(context)}
$blockers = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $cmd = [string]$_.CommandLine
  $name = [string]$_.Name
  (-not [string]::IsNullOrWhiteSpace($cmd)) -and
    ($name -notin @('Runner.Listener.exe', 'RunnerService.exe')) -and
    ($cmd -notlike '*openpath-ajax-direct*') -and
    (($cmd -match '\\\\_work\\\\') -or ($cmd -match 'actions-runner') -or ($cmd -match 'Runner\\.Worker'))
} | Select-Object -First 8 -Property Name, ProcessId, @{Name='Reason'; Expression={
  $cmd = [string]$_.CommandLine
  if ($cmd -match '\\\\_work\\\\') { 'runner-workspace' }
  elseif ($cmd -match 'Runner\\.Worker') { 'runner-worker' }
  else { 'actions-runner' }
}})
if ($blockers.Count -gt 0) {
  $summary = ($blockers | ForEach-Object { "$($_.Reason):$($_.Name):$($_.ProcessId)" }) -join ', '
  throw "Windows runner is busy during \${context}: $summary"
}
Write-Host "Windows runner execution idle: $context"
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 120 });
}

function pauseWindowsRunnerServices(options) {
  assertWindowsRunnerExecutionIdle(options, 'pre-direct-diagnostic');

  const script = `
$ErrorActionPreference = 'Stop'
$workspace = ${psSingleQuote(WINDOWS_WORKSPACE)}
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
$statePath = ${psSingleQuote(WINDOWS_RUNNER_SERVICE_STATE_ON_WINDOWS)}
$services = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object {
  ($_.Name -like 'actions.runner.*') -or
    ([string]$_.PathName -match 'RunnerService\\.exe') -or
    ([string]$_.PathName -match 'actions-runner')
} | Sort-Object Name)
$serviceState = @($services | Select-Object Name, State, StartMode)
$serviceState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
foreach ($service in @($services)) {
  if ($service.State -eq 'Running') {
    Stop-Service -Name $service.Name -Force -ErrorAction Stop
  }
}
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  $running = @(Get-Service -Name @($services.Name) -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Running' })
  if ($running.Count -eq 0) { break }
  Start-Sleep -Seconds 1
}
$stillRunning = @(Get-Service -Name @($services.Name) -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Running' })
if ($stillRunning.Count -gt 0) {
  throw "Timed out pausing GitHub runner services: $(@($stillRunning.Name) -join ', ')"
}
Write-Host "Paused GitHub runner services for direct Windows diagnostic: $(@($serviceState.Name) -join ', ')"
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 180 });
  assertWindowsRunnerExecutionIdle(options, 'after-pausing-runner-services');
}

function resumeWindowsRunnerServices(options) {
  const script = `
$ErrorActionPreference = 'Continue'
$statePath = ${psSingleQuote(WINDOWS_RUNNER_SERVICE_STATE_ON_WINDOWS)}
$serviceState = @()
if (Test-Path -LiteralPath $statePath) {
  $raw = Get-Content -LiteralPath $statePath -Raw
  if (-not [string]::IsNullOrWhiteSpace($raw)) {
    $serviceState = @($raw | ConvertFrom-Json)
  }
}
if ($serviceState.Count -eq 0) {
  $serviceState = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -like 'actions.runner.*') -or
      ([string]$_.PathName -match 'RunnerService\\.exe') -or
      ([string]$_.PathName -match 'actions-runner')
  } | Select-Object Name, State, StartMode)
}
foreach ($service in @($serviceState)) {
  if ([string]$service.StartMode -eq 'Disabled') { continue }
  Start-Service -Name $service.Name -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
Write-Host "Resumed GitHub runner services after direct Windows diagnostic: $(@($serviceState.Name) -join ', ')"
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 180 });
}

function runOpenPathUpdateAndSse(options) {
  const script = `
$ErrorActionPreference = 'Stop'
$openPathRoot = ${psSingleQuote(OPENPATH_ROOT_ON_WINDOWS)}
$etagPath = Join-Path $openPathRoot 'data\\whitelist.etag'
Remove-Item $etagPath -Force -ErrorAction SilentlyContinue
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $openPathRoot 'scripts\\Update-OpenPath.ps1')
if ($LASTEXITCODE -ne 0) {
  throw "Update-OpenPath.ps1 exited with code $LASTEXITCODE"
}
Stop-ScheduledTask -TaskName 'OpenPath-SSE' -ErrorAction SilentlyContinue
$logPath = Join-Path $openPathRoot 'data\\logs\\openpath.log'
$previousLogCount = if (Test-Path $logPath) { @((Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue)).Count } else { 0 }
Start-ScheduledTask -TaskName 'OpenPath-SSE'

# Wait for the restarted SSE task to connect before launching Firefox.
$deadline = (Get-Date).AddSeconds(150)
$connected = $false
while ((Get-Date) -lt $deadline) {
  $lines = if (Test-Path $logPath) { @(Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue) } else { @() }
  $newLines = if ($lines.Count -gt $previousLogCount) { $lines[$previousLogCount..($lines.Count - 1)] } else { @() }
  if (($newLines -join [Environment]::NewLine) -match 'SSE: Connected to API - listening for rule changes') {
    $connected = $true
    break
  }
  Start-Sleep -Seconds 2
}
if (-not $connected) {
  throw 'Timed out waiting for restarted OpenPath-SSE task to connect'
}
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 900 });
}

function registerOpenPathRuntimeTasksAndNativeHost(options) {
  const script = `
$ErrorActionPreference = 'Stop'
$openPathRoot = ${psSingleQuote(OPENPATH_ROOT_ON_WINDOWS)}
Import-Module (Join-Path $openPathRoot 'lib\\Common.psm1') -Force
Import-Module (Join-Path $openPathRoot 'lib\\Services.psm1') -Force
Import-Module (Join-Path $openPathRoot 'lib\\Browser.FirefoxNativeHost.psm1') -Force
$config = Get-OpenPathConfig
$updateInterval = if ($config.PSObject.Properties['updateIntervalMinutes'] -and $config.updateIntervalMinutes) { [int]$config.updateIntervalMinutes } else { 15 }
$watchdogInterval = if ($config.PSObject.Properties['watchdogIntervalMinutes'] -and $config.watchdogIntervalMinutes) { [int]$config.watchdogIntervalMinutes } else { 1 }
Register-OpenPathTask -UpdateIntervalMinutes $updateInterval -WatchdogIntervalMinutes $watchdogInterval | Out-Null
Register-OpenPathFirefoxNativeHost -Config $config | Out-Null
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 300 });
}

function refreshOpenPathIntegrity(options) {
  const script = `
$ErrorActionPreference = 'Stop'
Stop-ScheduledTask -TaskName 'OpenPath-Watchdog' -ErrorAction SilentlyContinue
Import-Module ${psSingleQuote(`${OPENPATH_ROOT_ON_WINDOWS}\\lib\\Common.psm1`)} -Force
if (-not (Save-OpenPathIntegrityBackup)) {
  throw 'Save-OpenPathIntegrityBackup failed after direct diagnostic overlay'
}
if (-not (New-OpenPathIntegrityBaseline)) {
  throw 'New-OpenPathIntegrityBaseline failed after direct diagnostic overlay'
}
Start-ScheduledTask -TaskName 'OpenPath-Watchdog'
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 300 });
}

function runAjaxCanary(options, plan, summary, billingContext, localFirefoxExtension) {
  const canaryEnvironment = buildWindowsAjaxCanaryGuestEnvironment({
    plan,
    summary,
    billingContext,
    canaryTimeoutMs: options.canaryTimeoutMs,
    postFailureObservationMs: options.postFailureObservationMs,
    localFirefoxExtension,
    redditNavigationMode: options.redditNavigationMode,
    redditDiagnosticRetryDelayMs: options.redditDiagnosticRetryDelayMs,
    redditNavigationTimeoutMs: options.redditNavigationTimeoutMs,
  });
  const scriptPath = `${WINDOWS_WORKSPACE}\\scripts\\windows-ajax-auto-allow-canary.mjs`;
  const firefoxEnv =
    localFirefoxExtension === null
      ? `
$gecko = (Get-Command geckodriver.exe -ErrorAction SilentlyContinue).Source
if (-not $gecko -and (Test-Path -LiteralPath 'C:\\tools\\selenium\\geckodriver.exe')) { $gecko = 'C:\\tools\\selenium\\geckodriver.exe' }
if ($gecko) { $env:GECKODRIVER_PATH = $gecko }
$policyFirefoxPath = @(
  'C:\\Program Files\\Mozilla Firefox',
  'C:\\Program Files (x86)\\Mozilla Firefox'
) | Where-Object {
  (Test-Path -LiteralPath (Join-Path $_ 'firefox.exe')) -and
  (Test-Path -LiteralPath (Join-Path $_ 'distribution\\policies.json')) -and
  ((Get-Content -LiteralPath (Join-Path $_ 'distribution\\policies.json') -Raw) -match 'monitor-bloqueos@openpath')
} | ForEach-Object { Join-Path $_ 'firefox.exe' } | Select-Object -First 1
if ($policyFirefoxPath) { $env:FIREFOX_PATH = $policyFirefoxPath }
`
      : `
$firefoxPolicyRegKey = 'HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox'
$firefoxPolicyRegPath = 'HKLM:\\SOFTWARE\\Policies\\Mozilla\\Firefox'
$firefoxPolicyBackupPath = Join-Path $env:TEMP ('openpath-firefox-policy-' + [Guid]::NewGuid().ToString('N') + '.reg')
$firefoxPolicyWasBackedUp = $false
if (Test-Path -LiteralPath $firefoxPolicyRegPath) {
  & reg.exe export $firefoxPolicyRegKey $firefoxPolicyBackupPath /y | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to export Firefox machine policy registry key: $firefoxPolicyRegKey"
  }
  Remove-Item -LiteralPath $firefoxPolicyRegPath -Recurse -Force
  $firefoxPolicyWasBackedUp = $true
}
$gecko = (Get-Command geckodriver.exe -ErrorAction SilentlyContinue).Source
if (-not $gecko -and (Test-Path -LiteralPath 'C:\\tools\\selenium\\geckodriver.exe')) { $gecko = 'C:\\tools\\selenium\\geckodriver.exe' }
if ($gecko) { $env:GECKODRIVER_PATH = $gecko }
$firefoxPath = @('C:\\Program Files\\Firefox Developer Edition\\firefox.exe','C:\\Program Files\\Firefox Nightly\\firefox.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($firefoxPath) { $env:FIREFOX_PATH = $firefoxPath }
`;
  const script = `
$ErrorActionPreference = 'Stop'
${renderPowerShellEnvironment(canaryEnvironment)}
$firefoxPolicyRegPath = 'HKLM:\\SOFTWARE\\Policies\\Mozilla\\Firefox'
$firefoxPolicyBackupPath = $null
$firefoxPolicyWasBackedUp = $false
${firefoxEnv}
try {
  node ${psSingleQuote(scriptPath)}
  $canaryExitCode = $LASTEXITCODE
} finally {
  $diagnosticProcesses = Get-CimInstance Win32_Process -Filter "Name = 'geckodriver.exe' OR Name = 'firefox.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.Name -eq 'geckodriver.exe') -or
      ($_.CommandLine -like '*openpath-ajax-auto-allow-firefox-*') -or
      ($_.CommandLine -like '*openpath-ajax-direct*') -or
      ($_.CommandLine -like '*--websocket-port=*')
    }
  foreach ($process in @($diagnosticProcesses)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($firefoxPolicyWasBackedUp) {
    Remove-Item -LiteralPath $firefoxPolicyRegPath -Recurse -Force -ErrorAction SilentlyContinue
    & reg.exe import $firefoxPolicyBackupPath | Out-Null
    Remove-Item -LiteralPath $firefoxPolicyBackupPath -Force -ErrorAction SilentlyContinue
  }
}
if ($canaryExitCode -ne 0) {
  throw "windows-ajax-auto-allow-canary.mjs exited with code $canaryExitCode"
}
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 900 });
}

function cleanupWindowsAjaxBrowserProcesses(options) {
  const script = `
$ErrorActionPreference = 'Continue'
$processes = Get-CimInstance Win32_Process -Filter "Name = 'geckodriver.exe' OR Name = 'firefox.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.CommandLine -like '*openpath-ajax-auto-allow-firefox-*') -or
    ($_.CommandLine -like '*openpath-ajax-direct*') -or
    ($_.CommandLine -like '*--websocket-port=*')
  }
foreach ($process in @($processes)) {
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    Write-Host "Stopped diagnostic browser process $($process.Name) pid=$($process.ProcessId)"
  } catch {
    Write-Warning "Failed to stop diagnostic browser process $($process.Name) pid=$($process.ProcessId): $_"
  }
}
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 120 });
}

function collectArtifacts(options, artifactDir) {
  const ajaxArtifact = readGuestFileUtf8(
    options,
    `${WINDOWS_WORKSPACE}\\production-windows-ajax-auto-allow-canary.json`
  );
  if (ajaxArtifact.trim()) {
    writeFileSync(
      resolve(artifactDir, 'production-windows-ajax-auto-allow-canary.json'),
      ajaxArtifact,
      'utf8'
    );
  }

  const openPathLogTail = readGuestText(
    options,
    `${OPENPATH_ROOT_ON_WINDOWS}\\data\\logs\\openpath.log`,
    60000
  );
  writeFileSync(resolve(artifactDir, 'openpath.log.tail.txt'), openPathLogTail, 'utf8');

  const nativeLogTail = readGuestText(
    options,
    `${OPENPATH_ROOT_ON_WINDOWS}\\browser-extension\\firefox\\native\\native-host.log`,
    60000
  );
  writeFileSync(resolve(artifactDir, 'native-host.log.tail.txt'), nativeLogTail, 'utf8');
}

function summarizeAjaxArtifact(plan) {
  // This enriches local direct-run evidence with failureBoundary and diagnosticPhases.
  summarizeRunnerDiagnosticArtifact(plan, {
    dryRun: DRY_RUN,
    outputFields: ['failureBoundary', 'diagnosticPhases'],
    runCommand: ({ command, args, env }) => runCommand([command, ...args], { env }),
  });
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  }

  if (!['staging', 'production'].includes(options.environment)) {
    console.error(`Unsupported environment: ${options.environment}`);
    process.exit(1);
  }

  if (!['managed', 'local'].includes(options.firefoxExtensionSource)) {
    console.error(`Unsupported Firefox extension source: ${options.firefoxExtensionSource}`);
    process.exit(1);
  }

  if (!['managed', 'local-installer-runtime'].includes(options.windowsBootstrapSource)) {
    console.error(`Unsupported Windows bootstrap source: ${options.windowsBootstrapSource}`);
    process.exit(1);
  }

  if (!['off', 'diagnostic', 'gate'].includes(options.redditNavigationMode)) {
    console.error(`Unsupported Reddit navigation mode: ${options.redditNavigationMode}`);
    process.exit(1);
  }

  if (!DRY_RUN && !options.vmid) {
    console.error('Direct Windows AJAX diagnostics require --vmid or WINDOWS_RUNNER_VMID.');
    process.exit(1);
  }

  const env = { ...loadRunnerDiagnosticEnvLocal(projectRoot), ...process.env };
  const baseUrl = resolveRunnerDiagnosticBaseUrl({
    baseUrl: options.baseUrl,
    environment: options.environment,
    getDeployTarget,
  });
  const artifactDir = resolveRunnerDiagnosticArtifactDir({
    projectRoot,
    artifactDir: options.artifactDir,
    defaultSubdir: 'windows-ajax-direct',
    environment: options.environment,
    includeEnvironmentInDefault: true,
  });
  const plan = buildRunnerDiagnosticPlan({
    platform: 'windows',
    suite: 'ajax-auto-allow',
    environment: options.environment,
    baseUrl,
    artifactDir,
    openpathRoot: options.openpathRoot,
    proxmoxHost: options.proxmoxHost,
    vmid: options.vmid,
    confirmProduction: options.confirmProduction,
  });
  const validationErrors = validateRunnerDiagnosticPlan(plan);

  initializeRunnerDiagnosticRuntime(plan, {
    dryRun: DRY_RUN,
    validationErrors,
    summaryLines: summarizeRunnerDiagnosticPlan(plan),
    summaryLineFilter: (line) => !line.startsWith('firefox_mode='),
  });
  console.log(`firefox_extension_source=${options.firefoxExtensionSource}`);
  console.log(`windows_bootstrap_source=${options.windowsBootstrapSource}`);
  console.log(`reddit_navigation_mode=${options.redditNavigationMode}`);

  ensureFilesExist(options, plan);

  const localFirefoxExtension = await buildLocalFirefoxExtension(options, artifactDir);
  const seleniumNodeModulesBundle = buildSeleniumNodeModulesBundle(options, artifactDir);

  let runnerServicesPaused = false;
  try {
    verifyWindowsPreflight(options);
    pauseWindowsRunnerServices(options);
    runnerServicesPaused = true;

    const billingContext = resolveBillingContext(options, env);
    const summary = provisionCanary({ options, baseUrl, artifactDir, billingContext, env });
    summary.apiUrl = summary.apiUrl || baseUrl;

    if (!options.skipReset) {
      uploadWindowsRunnerDnsRepairScript(options);
      resetWindowsClient(options, baseUrl);
    }
    if (seleniumNodeModulesBundle !== null) {
      writeGuestBinary(
        options,
        seleniumNodeModulesBundle.localPath,
        seleniumNodeModulesBundle.remotePath
      );
    }
    ensureSeleniumFirefoxCanarySupport(options);
    installWindowsClient(options, summary);

    uploadRunnerDiagnosticPlanFiles(plan, {
      projectRoot,
      openpathRoot: options.openpathRoot,
      sections: ['openpathOverlays'],
      writeText: (sourcePath, destinationPath) =>
        writeGuestText(options, sourcePath, destinationPath),
    });
    registerOpenPathRuntimeTasksAndNativeHost(options);
    refreshOpenPathIntegrity(options);
    runOpenPathUpdateAndSse(options);

    uploadRunnerDiagnosticPlanFiles(plan, {
      projectRoot,
      openpathRoot: options.openpathRoot,
      sections: ['canaryScriptUploads'],
      writeText: (sourcePath, destinationPath) =>
        writeGuestText(options, sourcePath, destinationPath),
    });
    const canaryEnvironment = buildWindowsAjaxCanaryGuestEnvironment({
      plan,
      summary,
      billingContext,
      canaryTimeoutMs: options.canaryTimeoutMs,
      postFailureObservationMs: options.postFailureObservationMs,
      localFirefoxExtension,
      redditNavigationMode: options.redditNavigationMode,
      redditDiagnosticRetryDelayMs: options.redditDiagnosticRetryDelayMs,
      redditNavigationTimeoutMs: options.redditNavigationTimeoutMs,
    });
    const visibleCanaryEnvironment = {
      WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE: canaryEnvironment.WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE,
      WINDOWS_BLOCKED_PAGE_UNBLOCK_REQUEST_DOMAIN:
        canaryEnvironment.WINDOWS_BLOCKED_PAGE_UNBLOCK_REQUEST_DOMAIN,
      WINDOWS_AJAX_REDDIT_NAVIGATION_MODE: canaryEnvironment.WINDOWS_AJAX_REDDIT_NAVIGATION_MODE,
      WINDOWS_AJAX_REDDIT_DIAGNOSTIC_RETRY_DELAY_MS:
        canaryEnvironment.WINDOWS_AJAX_REDDIT_DIAGNOSTIC_RETRY_DELAY_MS,
      WINDOWS_AJAX_REDDIT_NAVIGATION_TIMEOUT_MS:
        canaryEnvironment.WINDOWS_AJAX_REDDIT_NAVIGATION_TIMEOUT_MS,
    };
    if (localFirefoxExtension !== null) {
      writeGuestBinary(options, localFirefoxExtension.localPath, localFirefoxExtension.remotePath);
      visibleCanaryEnvironment.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH =
        canaryEnvironment.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH;
      visibleCanaryEnvironment.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_VERSION =
        canaryEnvironment.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_VERSION;
    }
    visibleCanaryEnvironment.WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL =
      canaryEnvironment.WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL;
    emitRunnerDiagnosticEnvironment(plan, {
      prefix: 'guest-env: ',
      environment: visibleCanaryEnvironment,
    });
    let canaryError = null;
    try {
      runAjaxCanary(options, plan, summary, billingContext, localFirefoxExtension);
    } catch (error) {
      canaryError = error;
    } finally {
      try {
        cleanupWindowsAjaxBrowserProcesses(options);
      } catch (cleanupError) {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.error(`Windows AJAX diagnostic browser cleanup failed: ${message}`);
      }
      if (!DRY_RUN) {
        try {
          collectArtifacts(options, artifactDir);
          summarizeAjaxArtifact(plan);
        } catch (artifactError) {
          if (!canaryError) {
            throw artifactError;
          }
          console.error(
            artifactError instanceof Error
              ? `Artifact collection failed after canary failure: ${artifactError.message}`
              : `Artifact collection failed after canary failure: ${String(artifactError)}`
          );
        }
      } else {
        summarizeAjaxArtifact(plan);
      }
    }

    if (canaryError) {
      throw canaryError;
    }

    console.log(`direct Windows AJAX diagnostic complete: ${artifactDir}`);
  } finally {
    if (runnerServicesPaused) {
      try {
        resumeWindowsRunnerServices(options);
      } catch (resumeError) {
        const message = resumeError instanceof Error ? resumeError.message : String(resumeError);
        console.error(`Failed to resume GitHub runner services: ${message}`);
      }
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
