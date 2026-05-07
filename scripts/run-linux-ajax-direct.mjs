#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { getDeployTarget } from './deploy-targets.mjs';
import {
  buildLinuxAjaxCanaryEnvironment,
  buildRunnerDiagnosticPlan,
  initializeRunnerDiagnosticRuntime,
  loadRunnerDiagnosticEnvLocal,
  readRunnerDiagnosticKeyValueFile,
  resolveRunnerDiagnosticArtifactDir,
  resolveRunnerDiagnosticBaseUrl,
  summarizeRunnerDiagnosticArtifact,
  summarizeRunnerDiagnosticEnvironmentVariables,
  summarizeRunnerDiagnosticPlan,
  validateRunnerDiagnosticPlan,
} from './lib/runner-diagnostic-execution.mjs';

const DEFAULT_ENVIRONMENT = 'staging';
const DRY_RUN = process.env.LINUX_AJAX_DIRECT_DRY_RUN === '1';
const FAKE_SUDO_FAILURE = process.env.LINUX_AJAX_DIRECT_FAKE_SUDO_FAILURE === '1';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');

function printUsage() {
  console.error(`Usage:
  npm run diagnostics:linux-ajax:direct -- [options]

Options:
  --environment <name>             staging | production (default: ${DEFAULT_ENVIRONMENT})
  --base-url <url>                 Public ClassroomPath URL override
  --artifact-dir <path>            Evidence directory (default: .opencode/tmp/linux-ajax-direct/<timestamp>)
  --confirm-production             Required when --environment production
  --confirm-local-state-reset      Required before resetting the local Linux OpenPath client state
`);
}

function parseArgs(argv) {
  const options = {
    environment: DEFAULT_ENVIRONMENT,
    baseUrl: '',
    artifactDir: '',
    confirmProduction: false,
    confirmLocalStateReset: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    if (arg === '--environment') options.environment = next();
    else if (arg === '--base-url') options.baseUrl = next();
    else if (arg === '--artifact-dir') options.artifactDir = resolve(projectRoot, next());
    else if (arg === '--confirm-production') options.confirmProduction = true;
    else if (arg === '--confirm-local-state-reset') options.confirmLocalStateReset = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@=+-]+$/.test(text) ? text : `"${text.replace(/"/g, '\\"')}"`;
}

function renderCommand(command, args) {
  return [command, ...args].map(shellQuote).join(' ');
}

function runCommand(command, args, options = {}) {
  const {
    cwd = projectRoot,
    env = process.env,
    allowFailure = false,
    logDir = '',
    logName = '',
    displayArgs = args,
  } = options;
  if (DRY_RUN) {
    console.log(renderCommand(command, displayArgs));
    if (FAKE_SUDO_FAILURE && command === 'sudo' && args[0] === '-n' && args[1] === 'true') {
      if (!allowFailure) throw new Error('sudo -n true failed with exit code 1');
      return 1;
    }
    return 0;
  }

  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (logDir && logName) {
    writeFileSync(
      resolve(logDir, `${logName}.log`),
      [
        `$ ${renderCommand(command, displayArgs)}`,
        `exit_status=${status}`,
        '',
        '--- stdout ---',
        result.stdout ?? '',
        '',
        '--- stderr ---',
        result.stderr ?? '',
      ].join('\n'),
      'utf8'
    );
  }
  if (status !== 0 && !allowFailure) {
    throw new Error(`${renderCommand(command, displayArgs)} failed with exit code ${status}`);
  }
  return status;
}

function redactAuthorizationHeader(value) {
  return value ? '[redacted]' : '';
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
  const envLocal = loadRunnerDiagnosticEnvLocal(projectRoot);
  const baseUrl = resolveRunnerDiagnosticBaseUrl({
    baseUrl: options.baseUrl,
    environment: options.environment,
    getDeployTarget,
  });
  const adminToken =
    process.env.CP_CLIENT_CANARY_ADMIN_TOKEN || envLocal.CP_CLIENT_CANARY_ADMIN_TOKEN || '';
  const artifactDir = resolveRunnerDiagnosticArtifactDir({
    projectRoot,
    artifactDir: options.artifactDir,
    defaultSubdir: 'linux-ajax-direct',
    environment: options.environment,
  });
  const plan = buildRunnerDiagnosticPlan({
    platform: 'linux',
    suite: 'ajax-auto-allow',
    environment: options.environment,
    baseUrl,
    artifactDir,
    confirmProduction: options.confirmProduction,
    confirmLocalStateReset: options.confirmLocalStateReset,
  });
  const validationErrors = validateRunnerDiagnosticPlan(plan);
  const bootstrapArtifact = plan.artifacts.linuxBootstrapCanary;
  const bootstrapOutput = plan.artifacts.linuxBootstrapOutput;
  const installerPath = plan.artifacts.linuxInstaller;

  initializeRunnerDiagnosticRuntime(plan, {
    dryRun: DRY_RUN,
    validationErrors,
    summaryLines: [
      ...summarizeRunnerDiagnosticPlan(plan),
      ...summarizeRunnerDiagnosticEnvironmentVariables(plan),
    ],
  });

  runCommand('sudo', ['-n', 'true'], {
    logDir: artifactDir,
    logName: 'preflight-sudo',
  });
  runCommand('curl', ['-fsS', `${baseUrl}/cp/health`], {
    logDir: artifactDir,
    logName: 'preflight-health',
  });
  for (const binary of ['curl', 'firefox', 'geckodriver']) {
    runCommand('bash', ['-lc', `command -v ${binary}`], {
      logDir: artifactDir,
      logName: `preflight-${binary}`,
    });
  }
  if (!adminToken) {
    throw new Error('CP_CLIENT_CANARY_ADMIN_TOKEN is required for direct Linux AJAX diagnostics.');
  }

  runCommand(process.execPath, ['scripts/create-production-linux-bootstrap-canary.mjs'], {
    env: {
      ...process.env,
      PRODUCTION_LINUX_BOOTSTRAP_CANARY_URL: baseUrl,
      PRODUCTION_LINUX_BOOTSTRAP_CANARY_BILLING_MODE: 'manual_only',
      PRODUCTION_LINUX_BOOTSTRAP_CANARY_ADMIN_TOKEN: adminToken,
      PRODUCTION_LINUX_BOOTSTRAP_CANARY_ARTIFACT_PATH: bootstrapArtifact,
      GITHUB_OUTPUT: bootstrapOutput,
    },
    logDir: artifactDir,
    logName: 'provision-linux-bootstrap-canary',
  });

  const bootstrap = readRunnerDiagnosticKeyValueFile(bootstrapOutput);
  const classroomId = bootstrap.classroom_id || '<classroom-id>';
  const enrollmentToken = bootstrap.enrollment_token || '<enrollment-token>';
  const groupId = bootstrap.group_id || '<group-id>';
  const extensionId = bootstrap.extension_id || 'monitor-bloqueos@openpath';
  const canaryEnvironment = buildLinuxAjaxCanaryEnvironment({
    plan,
    groupId,
    adminToken,
    extensionId,
  });

  runCommand(
    'curl',
    [
      '-fsSL',
      '-H',
      `Authorization: Bearer ${enrollmentToken}`,
      `${baseUrl}/api/enroll/${classroomId}`,
      '-o',
      installerPath,
    ],
    {
      logDir: artifactDir,
      logName: 'download-install-openpath',
      displayArgs: [
        '-fsSL',
        '-H',
        `Authorization: Bearer ${redactAuthorizationHeader(enrollmentToken)}`,
        `${baseUrl}/api/enroll/${classroomId}`,
        '-o',
        installerPath,
      ],
    }
  );

  runCommand(
    'sudo',
    [
      'systemctl',
      'stop',
      'openpath-sse-listener.service',
      'openpath-update.timer',
      'openpath-update.service',
      'dnsmasq',
    ],
    { allowFailure: true, logDir: artifactDir, logName: 'reset-stop-services' }
  );
  runCommand('sudo', ['rm', '-rf', '/etc/openpath', '/var/lib/openpath', '/var/log/openpath.log'], {
    logDir: artifactDir,
    logName: 'reset-remove-state',
  });

  runCommand('chmod', ['+x', installerPath], {
    logDir: artifactDir,
    logName: 'chmod-install-openpath',
  });
  runCommand('sudo', ['bash', installerPath], {
    logDir: artifactDir,
    logName: 'run-install-openpath',
  });

  const canaryStatus = runCommand(process.execPath, [plan.canary.command], {
    env: {
      ...process.env,
      ...canaryEnvironment,
    },
    allowFailure: true,
    logDir: artifactDir,
    logName: 'linux-ajax-auto-allow-canary',
  });

  summarizeRunnerDiagnosticArtifact(plan, {
    runCommand: ({ command, args, env, allowFailure, logDir, logName }) =>
      runCommand(command, args, { env, allowFailure, logDir, logName }),
    allowFailure: true,
    logDir: artifactDir,
    logName: 'summarize-linux-ajax-auto-allow-evidence',
  });

  if (!DRY_RUN) {
    writeFileSync(
      resolve(artifactDir, 'direct-linux-ajax-summary.json'),
      `${JSON.stringify({ artifactDir, canaryStatus }, null, 2)}\n`,
      'utf8'
    );
  }

  console.log(`direct Linux AJAX diagnostic evidence: ${artifactDir}`);
  if (canaryStatus !== 0) process.exit(canaryStatus);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
