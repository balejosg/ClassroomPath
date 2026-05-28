import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runProjectCommand } from './helpers/ops-contracts.ts';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');

function writeFakeGh(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const script = `#!/usr/bin/env bash
set -euo pipefail
state_file="$FAKE_GH_STATE"
mkdir -p "$(dirname "$state_file")"
case "$*" in
  workflow\\ run*)
    echo dispatched > "$state_file"
    exit 0
    ;;
  run\\ list*)
    count=0
    if [ -f "$state_file.count" ]; then
      count="$(cat "$state_file.count")"
    fi
    count=$((count + 1))
    echo "$count" > "$state_file.count"
    if [ "$count" -lt 2 ]; then
      printf '[]'
    else
      printf '[{"databaseId":987654,"displayTitle":"Linux Production Bootstrap Canary staging test-gate","createdAt":"2099-01-01T00:00:00Z"}]'
    fi
    exit 0
    ;;
  run\\ watch*)
    exit 0
    ;;
  api\\ repos/balejosg/ClassroomPath/actions/runs/987654*)
    printf '{"status":"completed","conclusion":"success"}'
    exit 0
    ;;
  run\\ download*)
    mkdir -p "$FAKE_GH_ARTIFACT"
    tmp="$(mktemp -d)"
    cat > "$tmp/production-linux-ajax-auto-allow-canary.json" <<'JSON'
{"success":true,"failureBoundary":{"id":"none","message":"ok"}}
JSON
    tar -czf "$FAKE_GH_ARTIFACT/linux-production-bootstrap-canary-evidence.tgz" -C "$tmp" production-linux-ajax-auto-allow-canary.json
    exit 0
    ;;
esac
echo "unexpected gh args: $*" >&2
exit 1
`;
  const ghPath = join(binDir, 'gh');
  writeFileSync(ghPath, script, { encoding: 'utf8', mode: 0o755 });
}

function writeWatchJobs404FakeGh(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const script = `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  workflow\\ run*)
    exit 0
    ;;
  run\\ list*)
    printf '[{"databaseId":987654,"displayTitle":"Linux Production Bootstrap Canary staging test-gate","createdAt":"2099-01-01T00:00:00Z"}]'
    exit 0
    ;;
  run\\ watch*)
    echo 'failed to get jobs: HTTP 404: 404 Not Found' >&2
    exit 1
    ;;
  api\\ repos/balejosg/ClassroomPath/actions/runs/987654*)
    printf '{"status":"completed","conclusion":"success"}'
    exit 0
    ;;
  run\\ download*)
    mkdir -p "$FAKE_GH_ARTIFACT"
    tmp="$(mktemp -d)"
    cat > "$tmp/production-linux-ajax-auto-allow-canary.json" <<'JSON'
{"success":true,"failureBoundary":{"id":"none","message":"ok"}}
JSON
    tar -czf "$FAKE_GH_ARTIFACT/linux-production-bootstrap-canary-evidence.tgz" -C "$tmp" production-linux-ajax-auto-allow-canary.json
    exit 0
    ;;
esac
echo "unexpected gh args: $*" >&2
exit 1
`;
  writeFileSync(join(binDir, 'gh'), script, { encoding: 'utf8', mode: 0o755 });
}

function writeMissingRunFakeGh(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const script = `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  workflow\\ run*)
    exit 0
    ;;
  run\\ list*)
    printf '[{"databaseId":111,"displayTitle":"Linux Production Bootstrap Canary staging other-gate","createdAt":"2099-01-01T00:00:00Z"}]'
    exit 0
    ;;
esac
echo "unexpected gh args: $*" >&2
exit 1
`;
  writeFileSync(join(binDir, 'gh'), script, { encoding: 'utf8', mode: 0o755 });
}

test('staging Linux bootstrap gate polls until GitHub exposes the correlated run', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'staging-linux-bootstrap-gate-'));
  const binDir = join(tempDir, 'bin');
  const artifactDir = resolve(projectRoot, '.opencode/tmp/staging-linux-bootstrap-gate/987654');
  const outputPath = join(tempDir, 'linux-bootstrap-gate.env');
  writeFakeGh(binDir);

  const result = runProjectCommand('node', ['scripts/run-staging-linux-bootstrap-gate.mjs'], {
    env: {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_GH_STATE: join(tempDir, 'gh-state'),
      FAKE_GH_ARTIFACT: artifactDir,
      STAGING_LINUX_BOOTSTRAP_GATE_ID: 'test-gate',
      STAGING_LINUX_BOOTSTRAP_GATE_OUTPUT: outputPath,
      STAGING_LINUX_BOOTSTRAP_GATE_RUN_RESOLVE_TIMEOUT_MS: '1000',
      STAGING_LINUX_BOOTSTRAP_GATE_RUN_RESOLVE_POLL_MS: '1',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(tempDir, 'gh-state.count'), 'utf8').trim(), '2');
  assert.match(readFileSync(outputPath, 'utf8'), /STAGING_LINUX_BOOTSTRAP_RUN_ID='987654'/);
  assert.match(readFileSync(outputPath, 'utf8'), /STAGING_LINUX_BOOTSTRAP_RESULT='success'/);
});

test('staging Linux bootstrap gate waits by run status when gh watch cannot read jobs', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'staging-linux-bootstrap-gate-'));
  const binDir = join(tempDir, 'bin');
  const artifactDir = resolve(projectRoot, '.opencode/tmp/staging-linux-bootstrap-gate/987654');
  const outputPath = join(tempDir, 'linux-bootstrap-gate.env');
  writeWatchJobs404FakeGh(binDir);

  const result = runProjectCommand('node', ['scripts/run-staging-linux-bootstrap-gate.mjs'], {
    env: {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_GH_ARTIFACT: artifactDir,
      STAGING_LINUX_BOOTSTRAP_GATE_ID: 'test-gate',
      STAGING_LINUX_BOOTSTRAP_GATE_OUTPUT: outputPath,
      STAGING_LINUX_BOOTSTRAP_GATE_RUN_RESOLVE_TIMEOUT_MS: '1000',
      STAGING_LINUX_BOOTSTRAP_GATE_RUN_RESOLVE_POLL_MS: '1',
      GITHUB_ACTIONS_RUN_WAIT_POLL_MS: '1',
      GITHUB_ACTIONS_RUN_WAIT_TIMEOUT_MS: '1000',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(outputPath, 'utf8'), /STAGING_LINUX_BOOTSTRAP_RUN_ID='987654'/);
  assert.match(readFileSync(outputPath, 'utf8'), /STAGING_LINUX_BOOTSTRAP_RESULT='success'/);
});

test('staging Linux bootstrap gate records a failure if the correlated run is never indexed', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'staging-linux-bootstrap-gate-'));
  const binDir = join(tempDir, 'bin');
  const outputPath = join(tempDir, 'gate.env');
  writeMissingRunFakeGh(binDir);

  const result = runProjectCommand('node', ['scripts/run-staging-linux-bootstrap-gate.mjs'], {
    env: {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      STAGING_LINUX_BOOTSTRAP_GATE_ID: 'missing-gate',
      STAGING_LINUX_BOOTSTRAP_GATE_OUTPUT: outputPath,
      STAGING_LINUX_BOOTSTRAP_GATE_RUN_RESOLVE_TIMEOUT_MS: '0',
      STAGING_LINUX_BOOTSTRAP_GATE_RUN_RESOLVE_POLL_MS: '0',
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(readFileSync(outputPath, 'utf8'), /STAGING_LINUX_BOOTSTRAP_RESULT='failure'/);
  assert.match(
    readFileSync(outputPath, 'utf8'),
    /STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID='workflow-run-resolution'/
  );
});

test('staging Linux bootstrap gate writes shell-safe output values', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'staging-linux-bootstrap-gate-'));
  const binDir = join(tempDir, 'bin');
  const artifactDir = resolve(projectRoot, '.opencode/tmp/staging-linux-bootstrap-gate/987654');
  const outputPath = join(tempDir, 'linux-bootstrap-gate.env');
  writeFakeGh(binDir);

  const result = runProjectCommand('node', ['scripts/run-staging-linux-bootstrap-gate.mjs'], {
    env: {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_GH_STATE: join(tempDir, 'gh-state'),
      FAKE_GH_ARTIFACT: artifactDir,
      STAGING_LINUX_BOOTSTRAP_GATE_ID: 'test-gate',
      STAGING_LINUX_BOOTSTRAP_GATE_OUTPUT: outputPath,
      STAGING_LINUX_BOOTSTRAP_GATE_RUN_RESOLVE_TIMEOUT_MS: '1000',
      STAGING_LINUX_BOOTSTRAP_GATE_RUN_RESOLVE_POLL_MS: '1',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const output = readFileSync(outputPath, 'utf8');
  assert.match(output, /STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE='ok'/);

  const sourceResult = runProjectCommand('bash', ['-n', outputPath]);
  assert.equal(sourceResult.status, 0, sourceResult.stderr);
});
