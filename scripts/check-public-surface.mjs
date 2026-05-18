import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const ignoredPathPatterns = [
  /^upstream\/openpath\//,
  /^node_modules\//,
  /^playwright-report\//,
  /^tests\/e2e\/test-results\//,
  /^coverage\//,
  /(^|\/)package-lock\.json$/,
  /^scripts\/check-public-surface\.mjs$/,
  /\.(?:png|jpg|jpeg|gif|webp|ico|woff2?)$/,
];

const allowedEnvExamples = new Set(['.env.local.example', 'config/.env.example']);

const checks = [
  {
    name: 'private key block',
    pattern: /BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/,
  },
  {
    name: 'GitHub token',
    pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{12,}\b/,
  },
  {
    name: 'provider token',
    pattern: /\b(?:sk_live|sk_test|rk_live|whsec|xox[baprs]?|AIza)[A-Za-z0-9_/-]{24,}\b/,
  },
  {
    name: 'private network IP',
    pattern:
      /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
  },
  {
    name: 'live ClassroomPath hostname',
    pattern: /\b(?:classroompath-staging\.duckdns\.org|classroompath\.eu)\b/i,
  },
  {
    name: 'DuckDNS hostname',
    pattern: /\b[a-z0-9.-]*duckdns\.org\b/i,
  },
  {
    name: 'local deploy path',
    pattern: /\/opt\/classroompath\b/,
  },
  {
    name: 'operator infrastructure identifier',
    pattern: /\b(?:whitelist-proxmox|classroompath-windows-\d+|student-linux|CT\s*\d+|VM\s*\d+)\b/i,
  },
  {
    name: 'staging smoke or canary URL',
    pattern:
      /\bhttps?:\/\/(?!(?:[^/"'`)]*\.)?(?:example\.invalid|example\.com|example\.test|test)(?:[/:)"'`]|\b))[^$<>\s"'`)]*(?:staging|smoke|canary)[^$<>\s"'`)]*/i,
  },
];

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((file) => !ignoredPathPatterns.some((pattern) => pattern.test(file)));
}

function isTrackedEnvLeak(file) {
  if (!/(^|\/)\.env(?:\.|$)/.test(file) && !/\/\.env(?:\.|$)/.test(file)) {
    return false;
  }
  return !allowedEnvExamples.has(file);
}

const findings = [];

for (const file of trackedFiles()) {
  if (isTrackedEnvLeak(file)) {
    findings.push({
      file,
      line: 1,
      name: 'tracked env file',
      text: 'tracked env files are private',
    });
    continue;
  }

  if (!existsSync(file)) {
    continue;
  }
  if (!statSync(file).isFile()) {
    continue;
  }

  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const check of checks) {
      if (check.pattern.test(line)) {
        findings.push({
          file,
          line: index + 1,
          name: check.name,
          text: line.trim().slice(0, 220),
        });
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Public surface check failed:');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.name}: ${finding.text}`);
  }
  process.exit(1);
}

console.log('Public surface check passed.');
