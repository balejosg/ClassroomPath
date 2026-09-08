import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  buildProductionTagIdentity,
  compareProductionTagIdentity,
  extractProductionTagIdentity,
  writeProductionTagIdentityFile,
} from '../scripts/promotion-evidence-cli.mjs';

const productionTagHelperPath = resolve(
  new URL('../scripts/lib/production-tag.sh', import.meta.url).pathname
);
const projectRoot = resolve(new URL('..', import.meta.url).pathname);

test('production tag identity round-trips the exact release and RC locator', () => {
  const releaseId = 'a'.repeat(64);
  const identity = buildProductionTagIdentity({
    releaseId,
    rcRunId: '123456789',
    classroomPathSha: 'b'.repeat(40),
  });
  const message = [
    'ClassroomPath production release v1.2.3',
    `ClassroomPath-Release-Id: ${identity.releaseId}`,
    `ClassroomPath-RC-Run-Id: ${identity.rcRunId}`,
    `ClassroomPath-SHA: ${identity.classroomPathSha}`,
  ].join('\n');

  assert.deepEqual(extractProductionTagIdentity(message), identity);
});

test('production tag identity can carry the complete immutable RC projection', () => {
  const identity = buildProductionTagIdentity({
    releaseId: 'a'.repeat(64),
    rcRunId: '123456789',
    classroomPathSha: 'b'.repeat(40),
    openpathSha: 'c'.repeat(40),
    contractSha256: 'd'.repeat(64),
  });
  const message = [
    `ClassroomPath-Release-Id: ${identity.releaseId}`,
    `ClassroomPath-RC-Run-Id: ${identity.rcRunId}`,
    `ClassroomPath-SHA: ${identity.classroomPathSha}`,
    `OpenPath-SHA: ${identity.openpathSha}`,
    `OpenPath-Contract-SHA256: ${identity.contractSha256}`,
  ].join('\n');

  assert.deepEqual(extractProductionTagIdentity(message), identity);
});

test('production tag identity rejects missing or conflicting fields', () => {
  assert.throws(
    () => buildProductionTagIdentity({ releaseId: 'a'.repeat(64), rcRunId: '' }),
    /rcRunId is required/
  );
  assert.throws(
    () => extractProductionTagIdentity('ClassroomPath-Release-Id: ' + 'a'.repeat(64)),
    /ClassroomPath-RC-Run-Id/
  );
  assert.throws(
    () =>
      extractProductionTagIdentity(
        [
          `ClassroomPath-Release-Id: ${'a'.repeat(64)}`,
          'ClassroomPath-RC-Run-Id: 123',
          `ClassroomPath-SHA: ${'b'.repeat(40)}`,
          `ClassroomPath-SHA: ${'c'.repeat(40)}`,
        ].join('\n')
      ),
    /duplicate ClassroomPath-SHA/
  );
});

test('writes the exact tag identity as shell-safe promotion inputs', () => {
  const outputPath = join(
    mkdtempSync(join(tmpdir(), 'classroompath-tag-identity-')),
    'identity.env'
  );
  try {
    writeProductionTagIdentityFile(outputPath, {
      releaseId: 'a'.repeat(64),
      rcRunId: '123456789',
      classroomPathSha: 'b'.repeat(40),
    });
    assert.equal(
      readFileSync(outputPath, 'utf8'),
      `RELEASE_ID=${'a'.repeat(64)}\nRC_RUN_ID=123456789\nCLASSROOMPATH_SHA=${'b'.repeat(40)}\n`
    );
  } finally {
    rmSync(outputPath, { force: true });
  }
});

test('classifies an existing annotated tag as idempotent only for the exact identity', () => {
  const expected = {
    releaseId: 'a'.repeat(64),
    rcRunId: '123456789',
    classroomPathSha: 'b'.repeat(40),
  };

  assert.deepEqual(compareProductionTagIdentity(expected, expected), {
    matches: true,
    mismatches: [],
  });
  assert.deepEqual(
    compareProductionTagIdentity({ ...expected, releaseId: 'c'.repeat(64) }, expected),
    { matches: false, mismatches: ['releaseId'] }
  );
});

test('fails closed when the remote tag lookup cannot be completed', () => {
  const result = spawnSync(
    'bash',
    [
      '-c',
      String.raw`set -u
source "$1"
die() { printf '%s\n' "$1" >&2; exit "$2"; }
git() {
  case "$1" in
    rev-parse) return 1 ;;
    ls-remote) return 42 ;;
    *) return 1 ;;
  esac
}
PRODUCTION_TAG_NAME=v1.2.3
PRODUCTION_TAG_TARGET_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
PRODUCTION_TAG_RELEASE_ID=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
PRODUCTION_TAG_RC_RUN_ID=123
PRODUCTION_TAG_CLASSROOMPATH_SHA=cccccccccccccccccccccccccccccccccccccccc
production_tag_reconcile_existing
`,
      'production-tag-remote-lookup-test',
      productionTagHelperPath,
    ],
    { encoding: 'utf-8' }
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unable to inspect origin tag v1\.2\.3/);
});

function createTagProductionFixture({ tagName = 'v9.9.9', nonCanonicalOperator = false } = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'classroompath-tag-local-only-'));
  const bareRepository = join(fixtureRoot, 'origin.git');
  const worktree = join(fixtureRoot, 'a', 'b', 'worktree');
  const fakeBin = join(fixtureRoot, 'bin');
  const guardDirectory = join(fixtureRoot, 'a', 'scripts');
  const guardLog = join(fixtureRoot, 'guard.log');
  const pushLog = join(fixtureRoot, 'push.log');
  const releaseId = 'a'.repeat(64);
  const openpathSha = 'b'.repeat(40);
  const contractFile = join(fixtureRoot, 'openpath-contract.json');
  const bundleFile = join(fixtureRoot, 'release-bundle.json');
  const stagingCurrentFile = join(fixtureRoot, 'staging-current.env');
  const stagingVerificationFile = join(fixtureRoot, 'staging-verification.env');

  try {
    mkdirSync(fakeBin, { recursive: true });
    execFileSync('git', ['clone', '--bare', projectRoot, bareRepository], { stdio: 'ignore' });
    mkdirSync(resolve(worktree, '..'), { recursive: true });
    execFileSync('git', ['clone', bareRepository, worktree], { stdio: 'ignore' });
    execFileSync('git', ['-C', worktree, 'config', 'user.name', 'Tag fixture']);
    execFileSync('git', ['-C', worktree, 'config', 'user.email', 'fixture@example.invalid']);

    const candidateSha = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    for (const relativePath of [
      'scripts/tag-production-release.sh',
      'scripts/require-main-branch.sh',
      'scripts/require-canonical-operator-tooling.sh',
      'scripts/lib/common.sh',
      'scripts/lib/github-token.sh',
      'scripts/lib/production-tag.sh',
    ]) {
      const sourcePath = resolve(projectRoot, relativePath);
      const targetPath = resolve(worktree, relativePath);
      cpSync(sourcePath, targetPath);
    }
    writeFileSync(resolve(worktree, 'operator-head-b-marker.txt'), 'operator checkout B\n', 'utf8');
    execFileSync('git', ['-C', worktree, 'add', 'scripts', 'operator-head-b-marker.txt']);
    execFileSync('git', ['-C', worktree, 'commit', '--quiet', '-m', 'operator checkout B']);
    const operatorHeadB = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['-C', worktree, 'push', '--quiet', 'origin', 'HEAD:main']);

    let operatorHead = operatorHeadB;
    if (nonCanonicalOperator) {
      writeFileSync(
        resolve(worktree, 'operator-head-x-marker.txt'),
        'operator checkout X\n',
        'utf8'
      );
      execFileSync('git', ['-C', worktree, 'add', 'operator-head-x-marker.txt']);
      execFileSync('git', ['-C', worktree, 'commit', '--quiet', '-m', 'operator checkout X']);
      operatorHead = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
    }

    mkdirSync(guardDirectory, { recursive: true });
    const guardPath = join(guardDirectory, 'parallel_session_guard.py');
    writeFileSync(
      guardPath,
      `#!/usr/bin/env python3
import json
import os
import sys

command = sys.argv[1] if len(sys.argv) > 1 else ''
if command == 'release-status':
    print(json.dumps({
        'state': 'staged',
        'release_id': os.environ['TEST_RELEASE_ID'],
        'classroompath_sha': os.environ['TEST_CANDIDATE_SHA'],
    }, separators=(',', ':')))
elif command == 'release-mark-tagged':
    with open(os.environ['TEST_GUARD_LOG'], 'a', encoding='utf-8') as handle:
        handle.write('release-mark-tagged\\n')
else:
    raise SystemExit(2)
`,
      'utf8'
    );
    chmodSync(guardPath, 0o755);

    const fakeNodePath = join(fakeBin, 'node');
    writeFileSync(
      fakeNodePath,
      `#!/usr/bin/env bash
set -euo pipefail

if [ -z "\${1:-}" ]; then
  printf '%s\\n' "\${FENCE_JSON:-}" | sed -n 's/.*"release_id":"\\([^"]*\\)".*/\\1/p'
  exit 0
fi

case "\$1" in
  scripts/promotion-evidence-cli.mjs)
    if [ "\${2:-}" = write-tag-message ]; then
      output=""
      tag=""
      release_id=""
      rc_run_id=""
      classroompath_sha=""
      openpath_sha=""
      contract_sha256=""
      shift 2
      while [ "\$#" -gt 0 ]; do
        case "\$1" in
          --output) output="\$2"; shift 2 ;;
          --tag) tag="\$2"; shift 2 ;;
          --release-id) release_id="\$2"; shift 2 ;;
          --rc-run-id) rc_run_id="\$2"; shift 2 ;;
          --classroompath-sha) classroompath_sha="\$2"; shift 2 ;;
          --openpath-sha) openpath_sha="\$2"; shift 2 ;;
          --contract-sha256) contract_sha256="\$2"; shift 2 ;;
          *) shift ;;
        esac
      done
      cat >"\$output" <<EOF
ClassroomPath production release \$tag
ClassroomPath-Release-Id: \$release_id
ClassroomPath-RC-Run-Id: \$rc_run_id
ClassroomPath-SHA: \$classroompath_sha
OpenPath-SHA: \$openpath_sha
OpenPath-Contract-SHA256: \$contract_sha256
EOF
    fi
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`,
      'utf8'
    );
    chmodSync(fakeNodePath, 0o755);

    writeFileSync(
      join(bareRepository, 'hooks', 'pre-receive'),
      '#!/usr/bin/env bash\nprintf \'push-attempted\\n\' >>"$TEST_PUSH_LOG"\nexit 1\n',
      'utf8'
    );
    chmodSync(join(bareRepository, 'hooks', 'pre-receive'), 0o755);

    writeFileSync(contractFile, '{"fixture":true}\n', 'utf8');
    writeFileSync(bundleFile, '{}\n', 'utf8');
    const contractSha256 = createHash('sha256').update(readFileSync(contractFile)).digest('hex');
    writeFileSync(
      stagingCurrentFile,
      [
        `APP_SHA=${candidateSha}`,
        `RELEASE_ID=${releaseId}`,
        'RC_RUN_ID=123',
        `OPENPATH_SHA=${openpathSha}`,
        `OPENPATH_CONTRACT_SHA256=${contractSha256}`,
        'IMAGE_SOURCE=release-candidate',
        '',
      ].join('\n'),
      'utf8'
    );
    writeFileSync(
      stagingVerificationFile,
      [
        `STAGING_VERIFIED_APP_SHA=${candidateSha}`,
        `STAGING_VERIFIED_RELEASE_ID=${releaseId}`,
        'STAGING_VERIFIED_RC_RUN_ID=123',
        `STAGING_VERIFIED_OPENPATH_SHA=${openpathSha}`,
        `STAGING_VERIFIED_OPENPATH_CONTRACT_SHA256=${contractSha256}`,
        'STAGING_VERIFIED_IMAGE_SOURCE=release-candidate',
        'STAGING_VERIFICATION_STATE=success',
        '',
      ].join('\n'),
      'utf8'
    );

    const args = [
      'scripts/tag-production-release.sh',
      tagName,
      '--rc-run-id',
      '123',
      '--candidate-sha',
      candidateSha,
      '--release-id',
      releaseId,
      '--openpath-sha',
      openpathSha,
      '--contract-sha256',
      contractSha256,
      '--bundle-file',
      bundleFile,
      '--contract-file',
      contractFile,
      '--staging-current',
      stagingCurrentFile,
      '--staging-verification',
      stagingVerificationFile,
      '--local-only',
    ];
    const environment = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      GH_TOKEN: 'fixture-token',
      GITHUB_TOKEN: 'fixture-token',
      TEST_RELEASE_ID: releaseId,
      TEST_CANDIDATE_SHA: candidateSha,
      TEST_GUARD_LOG: guardLog,
      TEST_PUSH_LOG: pushLog,
    };

    return {
      fixtureRoot,
      bareRepository,
      worktree,
      tagName,
      candidateSha,
      operatorHeadB,
      operatorHead,
      args,
      environment,
      guardLog,
      pushLog,
      cleanup: () => rmSync(fixtureRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    throw error;
  }
}

test('tag-production-release local-only accepts canonical B while tagging explicit RC A', () => {
  const fixture = createTagProductionFixture();
  try {
    assert.notEqual(fixture.candidateSha, fixture.operatorHead);
    assert.equal(fixture.operatorHead, fixture.operatorHeadB);
    assert.equal(
      execFileSync('git', ['-C', fixture.worktree, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      fixture.operatorHeadB
    );
    assert.equal(
      execFileSync('git', ['-C', fixture.worktree, 'rev-parse', 'origin/main'], {
        encoding: 'utf8',
      }).trim(),
      fixture.operatorHeadB
    );

    execFileSync('bash', fixture.args, {
      cwd: fixture.worktree,
      env: fixture.environment,
      stdio: 'pipe',
    });
    execFileSync('bash', fixture.args, {
      cwd: fixture.worktree,
      env: fixture.environment,
      stdio: 'pipe',
    });

    const taggedCommit = execFileSync(
      'git',
      ['-C', fixture.worktree, 'rev-parse', `refs/tags/${fixture.tagName}^{commit}`],
      { encoding: 'utf8' }
    ).trim();
    const remoteTag = execFileSync(
      'git',
      ['ls-remote', fixture.bareRepository, `refs/tags/${fixture.tagName}`],
      { encoding: 'utf8' }
    ).trim();

    assert.equal(taggedCommit, fixture.candidateSha);
    assert.equal(remoteTag, '');
    assert.equal(existsSync(fixture.guardLog) ? readFileSync(fixture.guardLog, 'utf8') : '', '');
    assert.equal(existsSync(fixture.pushLog) ? readFileSync(fixture.pushLog, 'utf8') : '', '');
  } finally {
    fixture.cleanup();
  }
});

test('tag-production-release blocks non-canonical tooling before local-only tag creation', () => {
  const fixture = createTagProductionFixture({
    tagName: 'v9.9.10',
    nonCanonicalOperator: true,
  });
  try {
    assert.notEqual(fixture.operatorHead, fixture.operatorHeadB);
    assert.equal(
      execFileSync('git', ['-C', fixture.worktree, 'rev-parse', 'origin/main'], {
        encoding: 'utf8',
      }).trim(),
      fixture.operatorHeadB
    );

    const result = spawnSync('bash', fixture.args, {
      cwd: fixture.worktree,
      env: fixture.environment,
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /operator tooling is not canonical origin\/main/u
    );
    assert.equal(
      execFileSync('git', ['-C', fixture.worktree, 'tag', '--list', fixture.tagName], {
        encoding: 'utf8',
      }).trim(),
      ''
    );
    assert.equal(
      execFileSync('git', ['ls-remote', fixture.bareRepository, `refs/tags/${fixture.tagName}`], {
        encoding: 'utf8',
      }).trim(),
      ''
    );
  } finally {
    fixture.cleanup();
  }
});
