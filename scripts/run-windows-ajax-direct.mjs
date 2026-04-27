#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { getDeployTarget } from './deploy-targets.mjs';

const DEFAULT_ENVIRONMENT = 'staging';
const DEFAULT_PROXMOX_HOST = 'whitelist-proxmox';
const DEFAULT_WINDOWS_RUNNER_VMID = '103';
const DEFAULT_CANARY_TIMEOUT_MS = '180000';
const DEFAULT_POST_FAILURE_OBSERVATION_MS = '60000';
const WINDOWS_WORKSPACE = 'C:\\Windows\\Temp\\openpath-ajax-direct';
const OPENPATH_ROOT_ON_WINDOWS = 'C:\\OpenPath';
const DRY_RUN = process.env.WINDOWS_AJAX_DIRECT_DRY_RUN === '1';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');

const OPENPATH_OVERLAYS = [
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

const CANARY_SCRIPT_UPLOADS = [
  {
    source: 'scripts/windows-ajax-auto-allow-canary.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\windows-ajax-auto-allow-canary.mjs`,
  },
  {
    source: 'scripts/lib/windows-auto-allow-canary-evidence.mjs',
    destination: `${WINDOWS_WORKSPACE}\\scripts\\lib\\windows-auto-allow-canary-evidence.mjs`,
  },
];

function printUsage() {
  console.error(`Usage:
  npm run diagnostics:windows-ajax:direct -- [options]

Options:
  --environment <name>        staging | production (default: ${DEFAULT_ENVIRONMENT})
  --base-url <url>            Public ClassroomPath URL override
  --openpath-root <path>      Local OpenPath checkout (default: ../OpenPath)
  --artifact-dir <path>       Local evidence directory (default: .opencode/tmp/windows-ajax-direct/<timestamp>)
  --proxmox-host <host>       Proxmox SSH host/alias (default: ${DEFAULT_PROXMOX_HOST})
  --vmid <id>                 Windows runner VMID (default: ${DEFAULT_WINDOWS_RUNNER_VMID})
  --canary-timeout-ms <ms>    Browser canary timeout (default: ${DEFAULT_CANARY_TIMEOUT_MS})
  --post-failure-observation-ms <ms>
                              Extra local observation window after canary failure (default: ${DEFAULT_POST_FAILURE_OBSERVATION_MS})
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

function loadEnvLocal() {
  const envPath = resolve(projectRoot, '.env.local');
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

function psSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function ensureFilesExist(options) {
  for (const upload of OPENPATH_OVERLAYS) {
    const sourcePath = resolve(options.openpathRoot, upload.source);
    if (!existsSync(sourcePath)) {
      throw new Error(`Required OpenPath overlay is missing: ${sourcePath}`);
    }
  }

  for (const upload of CANARY_SCRIPT_UPLOADS) {
    const sourcePath = resolve(projectRoot, upload.source);
    if (!existsSync(sourcePath)) {
      throw new Error(`Required canary helper is missing: ${sourcePath}`);
    }
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

function writeGuestText(options, localSourcePath, destinationPath) {
  const content = readFileSync(localSourcePath, 'utf8');
  const script = `
$ErrorActionPreference = 'Stop'
$path = ${psSingleQuote(destinationPath)}
$parent = Split-Path -Parent $path
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$content = [Console]::In.ReadToEnd()
Set-Content -LiteralPath $path -Value $content -Encoding UTF8
`;

  if (DRY_RUN) {
    console.log(`guest-upload: ${localSourcePath} -> ${destinationPath}`);
  }

  runGuestPowerShell(options, script, { input: content });
}

function readGuestText(options, sourcePath, maxChars = 200000) {
  const script = `
$ErrorActionPreference = 'Stop'
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

function buildDnsBootstrapScript(baseUrl) {
  const hostname = new URL(baseUrl).hostname;
  return `
$dnsServers = @('1.1.1.1', '8.8.8.8')
$networkAdapters = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })
foreach ($adapter in $networkAdapters) {
  Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses $dnsServers -ErrorAction SilentlyContinue
}
Resolve-DnsName -Name ${psSingleQuote(hostname)} -ErrorAction Stop | Out-Null
`;
}

function parseKeyValueFile(path) {
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = line.split('=');
    values[key] = valueParts.join('=');
  }
  return values;
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
      host: env.STAGING_HOST ?? '192.168.1.114',
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

  const remote = `grep '^${key}=' /opt/classroompath/app/config/.env | sed 's/^${key}=//' | head -n1`;
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
  const localArtifactPath = resolve(projectRoot, 'production-windows-bootstrap-canary.json');
  const provisionEnv = {
    ...env,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_URL: baseUrl,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_REQUEST_ORIGIN: new URL(baseUrl).origin,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_BILLING_MODE: billingContext.billingMode,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ADMIN_TOKEN: billingContext.adminToken,
    PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET: billingContext.stripeWebhookSecret,
    GITHUB_OUTPUT: outputPath,
  };

  if (DRY_RUN) {
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

  const outputs = parseKeyValueFile(outputPath);
  const summary = Object.fromEntries(
    Object.entries(outputs).map(([key, value]) => [camelFromSnake(key), value])
  );

  if (existsSync(localArtifactPath)) {
    copyFileSync(
      localArtifactPath,
      resolve(artifactDir, 'production-windows-bootstrap-canary.json')
    );
  }
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
  const script = `
$ErrorActionPreference = 'Stop'
${buildDnsBootstrapScript(summary.apiUrl)}
$workspace = ${psSingleQuote(WINDOWS_WORKSPACE)}
New-Item -ItemType Directory -Force -Path $workspace | Out-Null

$headers = @{ Authorization = ${psSingleQuote(`Bearer ${summary.enrollmentToken}`)} }
$windowsScriptUrl = ${psSingleQuote(summary.windowsScriptUrl ?? `${summary.apiUrl}/api/enroll/${summary.classroomId}/windows.ps1`)}
$windowsScriptPath = Join-Path $workspace 'windows.ps1'

Invoke-WebRequest -Uri $windowsScriptUrl -Headers $headers -OutFile $windowsScriptPath
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $windowsScriptPath
if ($LASTEXITCODE -ne 0) {
  throw "windows.ps1 exited with code $LASTEXITCODE"
}
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 1200 });
}

function resetWindowsClient(options, baseUrl) {
  const script = `
$ErrorActionPreference = 'Continue'
Get-ScheduledTask -TaskName 'OpenPath-*' -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
if (Test-Path 'C:\\OpenPath\\Uninstall-OpenPath.ps1') {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\\OpenPath\\Uninstall-OpenPath.ps1'
}
Remove-Item ${psSingleQuote(WINDOWS_WORKSPACE)} -Recurse -Force -ErrorAction SilentlyContinue
${buildDnsBootstrapScript(baseUrl)}
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

function runAjaxCanary(options, summary, billingContext) {
  const artifactPath = `${WINDOWS_WORKSPACE}\\production-windows-ajax-auto-allow-canary.json`;
  const scriptPath = `${WINDOWS_WORKSPACE}\\scripts\\windows-ajax-auto-allow-canary.mjs`;
  const script = `
$ErrorActionPreference = 'Stop'
$env:OPENPATH_ROOT = ${psSingleQuote(OPENPATH_ROOT_ON_WINDOWS)}
$env:WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL = ${psSingleQuote(summary.apiUrl)}
$env:WINDOWS_AJAX_AUTO_ALLOW_CANARY_GROUP_ID = ${psSingleQuote(summary.groupId)}
$env:WINDOWS_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN = ${psSingleQuote(billingContext.adminToken)}
$env:WINDOWS_AJAX_AUTO_ALLOW_CANARY_ARTIFACT = ${psSingleQuote(artifactPath)}
$env:WINDOWS_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS = ${psSingleQuote(options.canaryTimeoutMs)}
$env:WINDOWS_AJAX_AUTO_ALLOW_POST_FAILURE_OBSERVATION_MS = ${psSingleQuote(options.postFailureObservationMs)}
node ${psSingleQuote(scriptPath)}
if ($LASTEXITCODE -ne 0) {
  throw "windows-ajax-auto-allow-canary.mjs exited with code $LASTEXITCODE"
}
`;
  runGuestPowerShell(options, script, { timeoutSeconds: 900 });
}

function collectArtifacts(options, artifactDir) {
  const ajaxArtifact = readGuestText(
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

function main() {
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

  if (options.environment === 'production' && !options.confirmProduction) {
    console.error('Direct production diagnostics require --confirm-production.');
    process.exit(1);
  }

  const env = { ...loadEnvLocal(), ...process.env };
  const deployTarget = getDeployTarget(options.environment);
  const baseUrl = (options.baseUrl || deployTarget.publicUrl).replace(/\/$/, '');
  const artifactDir =
    options.artifactDir ||
    resolve(
      projectRoot,
      '.opencode/tmp/windows-ajax-direct',
      `${options.environment}-${new Date().toISOString().replace(/[:.]/g, '-')}`
    );

  ensureFilesExist(options);

  console.log(`target_environment=${options.environment}`);
  console.log(`base_url=${baseUrl}`);
  console.log(`artifact_dir=${artifactDir}`);
  console.log(
    `proxmox_guest_agent=ssh ${options.proxmoxHost} qm guest exec ${options.vmid} -- powershell.exe`
  );

  if (!DRY_RUN) {
    mkdirSync(artifactDir, { recursive: true });
  }

  const billingContext = resolveBillingContext(options, env);
  const summary = provisionCanary({ options, baseUrl, artifactDir, billingContext, env });
  summary.apiUrl = summary.apiUrl || baseUrl;

  verifyWindowsPreflight(options);
  if (!options.skipReset) {
    resetWindowsClient(options, baseUrl);
  }
  installWindowsClient(options, summary);

  for (const upload of OPENPATH_OVERLAYS) {
    writeGuestText(options, resolve(options.openpathRoot, upload.source), upload.destination);
  }
  refreshOpenPathIntegrity(options);
  runOpenPathUpdateAndSse(options);

  for (const upload of CANARY_SCRIPT_UPLOADS) {
    writeGuestText(options, resolve(projectRoot, upload.source), upload.destination);
  }
  console.log(`guest-env: WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL=${summary.apiUrl}`);
  let canaryError = null;
  try {
    runAjaxCanary(options, summary, billingContext);
  } catch (error) {
    canaryError = error;
  } finally {
    if (!DRY_RUN) {
      try {
        collectArtifacts(options, artifactDir);
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
    }
  }

  if (canaryError) {
    throw canaryError;
  }

  console.log(`direct Windows AJAX diagnostic complete: ${artifactDir}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
