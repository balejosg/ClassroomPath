import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { describe, test } from 'node:test';

import {
  cleanupTemporaryArtifactDir,
  downloadArtifactById,
  waitForArtifactResolution,
} from '../scripts/lib/github-actions-artifacts.mjs';

describe('github-actions-artifacts helper', () => {
  test('retries pending attempts until the artifact resolver succeeds', () => {
    let attempts = 0;

    const result = waitForArtifactResolution({
      timeoutSeconds: 1,
      intervalSeconds: 0,
      attempt() {
        attempts += 1;
        if (attempts < 3) {
          return { status: 'pending', context: { attempts } };
        }

        return { status: 'resolved', value: { artifactName: 'release-candidate-images-sha' } };
      },
      formatTimeoutError() {
        return 'should not time out';
      },
    });

    assert.equal(attempts, 3);
    assert.deepEqual(result, { artifactName: 'release-candidate-images-sha' });
  });

  test('formats timeout errors with the latest pending context', () => {
    assert.throws(
      () =>
        waitForArtifactResolution({
          timeoutSeconds: 0,
          intervalSeconds: 0,
          attempt() {
            return {
              status: 'pending',
              context: { lastState: 'pending', latestRunId: 12345 },
            };
          },
          formatTimeoutError(context) {
            return `timeout:lastState=${context.lastState};latestRunId=${context.latestRunId}`;
          },
        }),
      /timeout:lastState=pending;latestRunId=12345/
    );
  });

  test('reports pending resolution context before sleeping or timing out', () => {
    const pendingContexts: Array<Record<string, unknown>> = [];

    assert.throws(
      () =>
        waitForArtifactResolution({
          timeoutSeconds: 0,
          intervalSeconds: 0,
          attempt() {
            return {
              status: 'pending',
              context: { lastState: 'missing', latestRunId: 12345 },
            };
          },
          onPending(context) {
            pendingContexts.push(context);
          },
          formatTimeoutError() {
            return 'timeout';
          },
        }),
      /timeout/
    );

    assert.deepEqual(pendingContexts, [{ lastState: 'missing', latestRunId: 12345 }]);
  });

  test('requires both the attempt callback and timeout formatter', () => {
    assert.throws(() => waitForArtifactResolution({ formatTimeoutError() {} }), /attempt callback/);
    assert.throws(() => waitForArtifactResolution({ attempt() {} }), /timeout formatter/);
  });

  test('downloads artifact archives through gh stdout when gh api has no output flag', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'github-actions-artifacts-test-'));
    const fakeBin = resolve(tempDir, 'bin');
    const commandLog = resolve(tempDir, 'commands.log');
    const originalPath = process.env.PATH;
    const originalCommandLog = process.env.COMMAND_LOG;
    let artifactDir: string | null = null;

    mkdirSync(fakeBin);
    writeFileSync(
      resolve(fakeBin, 'gh'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'gh' >> "$COMMAND_LOG"
printf ' %q' "$@" >> "$COMMAND_LOG"
printf '\\n' >> "$COMMAND_LOG"

if [ "$1" != "api" ]; then
  exit 2
fi

output_file=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    output_file="$2"
    shift 2
    continue
  fi
  shift
done

if [ -z "$output_file" ]; then
  head -c 2097152 /dev/zero
  exit 0
fi

printf 'zip archive placeholder' > "$output_file"
`,
      'utf8'
    );
    writeFileSync(
      resolve(fakeBin, 'unzip'),
      `#!/usr/bin/env bash
set -euo pipefail
archive=''
dest=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d)
      dest="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      archive="$1"
      shift
      ;;
  esac
done

test -s "$archive"
mkdir -p "$dest"
printf 'extracted' > "$dest/extracted.txt"
`,
      'utf8'
    );
    chmodSync(resolve(fakeBin, 'gh'), 0o755);
    chmodSync(resolve(fakeBin, 'unzip'), 0o755);

    try {
      process.env.COMMAND_LOG = commandLog;
      process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ''}`;

      const result = downloadArtifactById({
        repo: 'owner/repo',
        artifactId: 123,
        cwd: tempDir,
        tempPrefix: 'github-actions-artifacts-test-download-',
      });
      artifactDir = result.artifactDir;

      const loggedCommand = readFileSync(commandLog, 'utf8');
      assert.equal(existsSync(resolve(result.artifactDir, 'extracted.txt')), true);
      assert.match(loggedCommand, /gh api repos\/owner\/repo\/actions\/artifacts\/123\/zip/);
      assert.doesNotMatch(loggedCommand, /--output/);
    } finally {
      if (artifactDir) {
        cleanupTemporaryArtifactDir(artifactDir);
      }
      process.env.PATH = originalPath;
      if (originalCommandLog === undefined) {
        delete process.env.COMMAND_LOG;
      } else {
        process.env.COMMAND_LOG = originalCommandLog;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
