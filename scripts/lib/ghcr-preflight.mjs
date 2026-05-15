import { execFile as nodeExecFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(nodeExecFile);
const DEFAULT_STAGING_HOST = '192.168.1.114';
const DEFAULT_STAGING_USER = 'deploy';
const DEFAULT_STAGING_PORT = '22';
const DEFAULT_STAGING_STRICT_HOSTKEY = 'accept-new';

export function classifyGhcrPreflightFailure(input) {
  const raw = normalizeFailureText(input);

  if (
    /(error from registry:\s*denied|requested access.*denied|denied:|unauthorized|authentication required|unauthorized to access repository)/i.test(
      raw
    )
  ) {
    return {
      kind: 'auth-denied',
      message:
        'GHCR access denied. Set STAGING_GHCR_USERNAME and STAGING_GHCR_TOKEN for this deploy command so the staging host can inspect private GHCR images.',
      raw,
    };
  }

  if (/(manifest unknown|no such manifest|manifest.*not found|not found: manifest)/i.test(raw)) {
    return {
      kind: 'manifest-unknown',
      message:
        'The release-candidate image manifest is missing from GHCR. Confirm the release-candidate image workflow published this digest before deploying staging.',
      raw,
    };
  }

  if (
    /(lookup .* no such host|temporary failure in name resolution|i\/o timeout|tls handshake timeout|connection refused|connection timed out|network is unreachable|no route to host|could not resolve|proxyconnect tcp|dial tcp)/i.test(
      raw
    )
  ) {
    return {
      kind: 'network',
      message:
        'The staging GHCR preflight could not reach the registry or Docker endpoint. Check network, DNS, SSH connectivity, and Docker access before retrying.',
      raw,
    };
  }

  return {
    kind: 'unknown',
    message:
      'The staging GHCR preflight failed for an unclassified reason. Inspect the Docker/SSH output above.',
    raw,
  };
}

export function collectGhcrImagesFromManifest(manifestFile) {
  const seen = new Set();
  const images = [];
  const text = readFileSync(manifestFile, 'utf8');

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed || !parsed.value.startsWith('ghcr.io/')) {
      continue;
    }

    if (!seen.has(parsed.value)) {
      seen.add(parsed.value);
      images.push(parsed.value);
    }
  }

  return images;
}

export async function preflightGhcrImages(images, dependencies = {}) {
  const runExecFile = dependencies.execFile ?? execFileWithInput;
  const imageRefs = normalizeImages(images);
  const checked = [];

  for (const image of imageRefs) {
    const result = await inspectImage({
      image,
      execFile: runExecFile,
      command: 'docker',
      args: ['buildx', 'imagetools', 'inspect', image],
    });

    if (!result.ok) {
      return { ...result, checked };
    }

    checked.push(image);
  }

  return { ok: true, checked, imageCount: checked.length };
}

export async function preflightGhcrImagesOnStaging(images, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const runExecFile = dependencies.execFile ?? execFileWithInput;
  const imageRefs = normalizeImages(images);
  const sshArgs = buildStagingSshArgs(env);
  const checked = [];

  const dockerAccess = await runRemote({
    execFile: runExecFile,
    sshArgs,
    remoteCommand: 'docker version >/dev/null',
  });

  if (!dockerAccess.ok) {
    return { ...dockerAccess, checked };
  }

  const username = String(env.STAGING_GHCR_USERNAME ?? '').trim();
  const token = String(env.STAGING_GHCR_TOKEN ?? '').trim();

  if ((username && !token) || (!username && token)) {
    throw new Error('STAGING_GHCR_USERNAME and STAGING_GHCR_TOKEN must be set together');
  }

  if (username && token) {
    const login = await runRemote({
      execFile: runExecFile,
      sshArgs,
      remoteCommand: `docker login ghcr.io -u ${shellQuote(username)} --password-stdin >/dev/null`,
      input: token,
    });

    if (!login.ok) {
      return { ...login, checked };
    }
  }

  for (const image of imageRefs) {
    const result = await runRemote({
      execFile: runExecFile,
      sshArgs,
      remoteCommand: `docker buildx imagetools inspect ${shellQuote(image)}`,
      image,
    });

    if (!result.ok) {
      return { ...result, checked };
    }

    checked.push(image);
  }

  return { ok: true, checked, imageCount: checked.length };
}

export function loadEnvFile(path, env = process.env) {
  let text = '';

  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed || Object.prototype.hasOwnProperty.call(env, parsed.key)) {
      continue;
    }
    env[parsed.key] = parsed.value;
  }
}

function buildStagingSshArgs(env) {
  const key = expandTilde(String(env.STAGING_SSH_KEY ?? '').trim());

  if (!key) {
    throw new Error('STAGING_SSH_KEY is required for staging GHCR preflight');
  }

  const host = String(env.STAGING_HOST ?? DEFAULT_STAGING_HOST).trim() || DEFAULT_STAGING_HOST;
  const user = String(env.STAGING_USER ?? DEFAULT_STAGING_USER).trim() || DEFAULT_STAGING_USER;
  const port = String(env.STAGING_PORT ?? DEFAULT_STAGING_PORT).trim() || DEFAULT_STAGING_PORT;
  const strictHostKey =
    String(env.STAGING_SSH_STRICT_HOSTKEY ?? DEFAULT_STAGING_STRICT_HOSTKEY).trim() ||
    DEFAULT_STAGING_STRICT_HOSTKEY;

  return [
    '-o',
    'ConnectTimeout=10',
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    `StrictHostKeyChecking=${strictHostKey}`,
    '-i',
    key,
    '-p',
    port,
    `${user}@${host}`,
  ];
}

async function inspectImage({ image, execFile, command, args }) {
  try {
    await execFile(command, args);
    return { ok: true, image };
  } catch (error) {
    const failure = classifyGhcrPreflightFailure(error);
    return { ok: false, image, failure };
  }
}

async function runRemote({ execFile, sshArgs, remoteCommand, image = '', input }) {
  try {
    await execFile('ssh', [...sshArgs, remoteCommand], input === undefined ? undefined : { input });
    return { ok: true, image };
  } catch (error) {
    const failure = classifyGhcrPreflightFailure(error);
    return { ok: false, image, failure };
  }
}

function normalizeImages(images) {
  const normalized = images.map((image) => String(image ?? '').trim()).filter(Boolean);

  if (normalized.length === 0) {
    throw new Error('At least one GHCR image ref is required');
  }

  return normalized;
}

function normalizeFailureText(input) {
  if (input instanceof Error) {
    return [input.message, input.stderr, input.stdout].filter(Boolean).join('\n');
  }

  if (typeof input === 'object' && input !== null) {
    return [input.message, input.stderr, input.stdout].filter(Boolean).join('\n');
  }

  return String(input ?? '');
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
  if (!match) {
    return null;
  }

  return {
    key: match[1],
    value: unquoteEnvValue(match[2].trim()),
  };
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function expandTilde(path) {
  if (path === '~') {
    return process.env.HOME ?? path;
  }

  if (path.startsWith('~/')) {
    return `${process.env.HOME ?? '~'}${path.slice(1)}`;
  }

  return path;
}

export function execFileWithInput(command, args, options = {}) {
  if (options?.input === undefined) {
    return execFileAsync(command, args);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (status) => {
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };

      if (status === 0) {
        resolve(result);
        return;
      }

      const error = new Error(result.stderr || `${command} exited with code ${status}`);
      error.status = status;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      reject(error);
    });

    child.stdin.end(options.input);
  });
}
