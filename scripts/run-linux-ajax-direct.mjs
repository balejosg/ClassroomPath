#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { getDeployTarget } from './deploy-targets.mjs';

const DEFAULT_ENVIRONMENT = 'staging';
const DRY_RUN = process.env.LINUX_AJAX_DIRECT_DRY_RUN === '1';
const FAKE_SUDO_FAILURE = process.env.LINUX_AJAX_DIRECT_FAKE_SUDO_FAILURE === '1';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');

function defaultArtifactDir() {
  return resolve(
    projectRoot,
    '.opencode/tmp/linux-ajax-direct',
    new Date().toISOString().replace(/[:.]/g, '-')
  );
}

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
    artifactDir: defaultArtifactDir(),
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

function loadEnvLocal() {
  const envPath = resolve(projectRoot, '.env.local');
  if (!existsSync(envPath)) return {};

  const env = {};
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
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

function readGithubOutput(path) {
  if (!existsSync(path)) return {};

  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || !line.includes('=')) continue;
    const [key, ...valueParts] = line.split('=');
    values[key] = valueParts.join('=');
  }
  return values;
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
  if (options.environment === 'production' && !options.confirmProduction) {
    console.error('Production Linux AJAX diagnostics require --confirm-production.');
    process.exit(1);
  }
  if (!options.confirmLocalStateReset) {
    console.error(
      'Direct Linux AJAX diagnostics reset local OpenPath state; pass --confirm-local-state-reset.'
    );
    process.exit(1);
  }

  const envLocal = loadEnvLocal();
  const baseUrl = (options.baseUrl || getDeployTarget(options.environment).publicUrl).replace(
    /\/$/,
    ''
  );
  const adminToken =
    process.env.CP_CLIENT_CANARY_ADMIN_TOKEN || envLocal.CP_CLIENT_CANARY_ADMIN_TOKEN || '';
  const artifactDir = options.artifactDir;
  const bootstrapArtifact = resolve(artifactDir, 'production-linux-bootstrap-canary.json');
  const bootstrapOutput = resolve(artifactDir, 'production-linux-bootstrap-canary.env');
  const canaryArtifact = resolve(artifactDir, 'production-linux-ajax-auto-allow-canary.json');
  const canarySummary = resolve(artifactDir, 'linux-ajax-auto-allow-canary-summary.md');
  const canaryOutput = resolve(artifactDir, 'linux-ajax-auto-allow-canary-summary.env');
  const installerPath = resolve(artifactDir, 'install-openpath.sh');

  console.log(`target_environment=${options.environment}`);
  console.log(`base_url=${baseUrl}`);
  console.log(`artifact_dir=${artifactDir}`);
  console.log(`PRODUCTION_LINUX_BOOTSTRAP_CANARY_URL=${baseUrl}`);
  console.log(`PRODUCTION_LINUX_BOOTSTRAP_CANARY_ARTIFACT_PATH=${bootstrapArtifact}`);
  console.log(`LINUX_AJAX_AUTO_ALLOW_CANARY_ARTIFACT=${canaryArtifact}`);

  if (!DRY_RUN) mkdirSync(artifactDir, { recursive: true });

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

  const bootstrap = readGithubOutput(bootstrapOutput);
  const classroomId = bootstrap.classroom_id || '<classroom-id>';
  const enrollmentToken = bootstrap.enrollment_token || '<enrollment-token>';
  const groupId = bootstrap.group_id || '<group-id>';
  const extensionId = bootstrap.extension_id || 'monitor-bloqueos@openpath';

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

  const canaryStatus = runCommand(process.execPath, ['scripts/linux-ajax-auto-allow-canary.mjs'], {
    env: {
      ...process.env,
      LINUX_AJAX_AUTO_ALLOW_CANARY_API_URL: baseUrl,
      LINUX_AJAX_AUTO_ALLOW_CANARY_GROUP_ID: groupId,
      LINUX_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN: adminToken,
      LINUX_AJAX_AUTO_ALLOW_CANARY_ARTIFACT: canaryArtifact,
      EXPECTED_EXTENSION_ID: extensionId,
    },
    allowFailure: true,
    logDir: artifactDir,
    logName: 'linux-ajax-auto-allow-canary',
  });

  runCommand(
    process.execPath,
    [
      'scripts/summarize-linux-ajax-auto-allow-evidence.mjs',
      '--artifact',
      canaryArtifact,
      '--summary',
      canarySummary,
    ],
    {
      env: {
        ...process.env,
        GITHUB_OUTPUT: canaryOutput,
      },
      allowFailure: true,
      logDir: artifactDir,
      logName: 'summarize-linux-ajax-auto-allow-evidence',
    }
  );

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
