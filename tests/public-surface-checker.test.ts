import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkerPath = resolve(projectRoot, 'scripts/check-public-surface.mjs');

function runCheckerWithFiles(files: Record<string, string>) {
  const repoDir = mkdtempSync(resolve(tmpdir(), 'public-surface-checker-'));
  mkdirSync(resolve(repoDir, 'scripts'), { recursive: true });
  cpSync(checkerPath, resolve(repoDir, 'scripts/check-public-surface.mjs'));
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });

  for (const [file, content] of Object.entries(files)) {
    const absolutePath = resolve(repoDir, file);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }

  execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' });
  return spawnSync('node', ['scripts/check-public-surface.mjs'], {
    cwd: repoDir,
    encoding: 'utf8',
  });
}

describe('public surface checker', () => {
  test('blocks reconstructed leaks from format, join, printf, and split tokens', () => {
    const result = runCheckerWithFiles({
      'docs/reconstructed.md': [
        "const url = format('https://{0}.{1}', 'classroompath', 'eu');",
        "const runner = ['classroompath-windows', '103'].join('-');",
        "const privateIp = [192, 168, 1, 114].join('.');",
        "printf '/%s/%s\\n' opt classroompath",
        'ssh host qm guest exec 103 -- powershell.exe',
        "const host = 'classroom' + 'path' + '.' + 'eu';",
      ].join('\n'),
    });

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /reconstructed public surface leak/i);
    assert.match(result.stderr, /docs\/reconstructed\.md:1/);
    assert.match(result.stderr, /docs\/reconstructed\.md:2/);
    assert.match(result.stderr, /docs\/reconstructed\.md:3/);
    assert.match(result.stderr, /docs\/reconstructed\.md:4/);
    assert.match(result.stderr, /docs\/reconstructed\.md:5/);
    assert.match(result.stderr, /docs\/reconstructed\.md:6/);
  });

  test('keeps direct public-surface leaks blocked', () => {
    const result = runCheckerWithFiles({
      'docs/direct.md': [
        'https://classroompath.eu',
        'https://classroompath-staging.duckdns.org',
        '10.1.2.3',
        'classroompath-windows-103',
        '/opt/classroompath',
      ].join('\n'),
    });

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /live ClassroomPath hostname/);
    assert.match(result.stderr, /DuckDNS hostname/);
    assert.match(result.stderr, /private network IP/);
    assert.match(result.stderr, /operator infrastructure identifier/);
    assert.match(result.stderr, /local deploy path/);
  });

  test('allows reserved placeholder hostnames', () => {
    const result = runCheckerWithFiles({
      'docs/placeholders.md': [
        'https://classroompath.example.invalid',
        'https://classroompath.example.com',
        'https://classroompath.example.test',
      ].join('\n'),
    });

    assert.equal(result.status, 0, result.stderr);
  });
});
