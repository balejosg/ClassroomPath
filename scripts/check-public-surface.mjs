/**
 * Scans all tracked files in the repo for private hostnames, internal IPs, and secret patterns that must not appear on the public surface.
 *
 * Invoked by: CI commit gate via `npm run verify:public-surface`; also part of `npm run verify:commit`.
 * Usage: node scripts/check-public-surface.mjs
 */
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
  /^tests\/public-surface-checker\.test\.ts$/,
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
    pattern:
      /\b(?:whitelist-proxmox|classroompath-windows-\d+|classroompath-linux-\d+|student-linux|CT\s*\d+|VM\s*\d+|vmid\s*[:=]\s*['"]?\d+['"]?|qm\s+(?:guest\s+exec|rollback|set|start|status|listsnapshot|config)\s+\d+)\b/i,
  },
  {
    name: 'staging smoke or canary URL',
    pattern:
      /\bhttps?:\/\/(?!(?:[^/"'`)]*\.)?(?:example\.invalid|example\.com|example\.test|test)(?:[/:)"'`]|\b))[^$<>\s"'`)]*(?:staging|smoke|canary)[^$<>\s"'`)]*/i,
  },
];

function unquoteToken(token) {
  return token
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\(['"`\\])/g, '$1');
}

function quotedStrings(text) {
  return [...text.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((match) => unquoteToken(match[0]));
}

function splitArgs(text) {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function literalTokenValue(token) {
  const trimmed = token.trim();
  if (/^['"`]/.test(trimmed)) {
    return unquoteToken(trimmed);
  }
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function reconstructedCandidates(line) {
  const candidates = [];

  for (const match of line.matchAll(/\bformat\(([^)]*)\)/g)) {
    const args = splitArgs(match[1]);
    const template = args[0];
    if (!template || !/^['"`]/.test(template)) {
      continue;
    }
    let rendered = unquoteToken(template);
    for (const [index, arg] of args.slice(1).entries()) {
      if (/^['"`]/.test(arg)) {
        rendered = rendered.replaceAll(`{${index}}`, unquoteToken(arg));
      }
    }
    candidates.push(rendered);
  }

  for (const match of line.matchAll(/\[((?:[^\]])*)\]\.join\(([^)]*)\)/g)) {
    const parts = splitArgs(match[1])
      .map(literalTokenValue)
      .filter((part) => part !== null);
    const separator = literalTokenValue(match[2].trim()) ?? '';
    if (parts.length > 0) {
      candidates.push(parts.join(separator));
    }
  }

  for (const match of line.matchAll(/\bprintf\s+((['"`])(?:\\.|(?!\2).)*\2)\s+(.+)$/g)) {
    const template = unquoteToken(match[1]);
    const args = match[3].trim().split(/\s+/);
    let index = 0;
    candidates.push(template.replace(/%s/g, () => args[index++] ?? ''));
  }

  const stringParts = quotedStrings(line);
  if (stringParts.length > 1) {
    candidates.push(stringParts.join(''));
  }

  return candidates;
}

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
    for (const candidate of reconstructedCandidates(line)) {
      for (const check of checks) {
        if (check.pattern.test(candidate)) {
          findings.push({
            file,
            line: index + 1,
            name: 'reconstructed public surface leak',
            text: line.trim().slice(0, 220),
          });
          break;
        }
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Public surface check failed:');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.name}: ${finding.text}`);
  }
  console.error('');
  console.error('How to fix (policy lives in scripts/check-public-surface.mjs):');
  console.error(
    '  live/staging hostname      -> use a placeholder ending in .invalid, e.g. app.example.invalid'
  );
  console.error(
    '  private or LAN IP address  -> use RFC 5737 documentation addresses (192.0.2.x, 198.51.100.x,'
  );
  console.error('                                203.0.113.x) or the loopback address 127.0.0.1');
  console.error(
    '  operator/VM/runner id      -> use a generic label, e.g. <runner-hostname> or runner-01'
  );
  console.error('  private filesystem path    -> use a generic placeholder, e.g. /srv/appname');
  console.error(
    '  secret or token value      -> remove entirely; load from env at runtime, never commit'
  );
  console.error(
    '  reconstructed leak (format/join/printf) -> apply the fix to the original source string'
  );
  console.error(
    '  Example fixtures: tests/public-surface-checker.test.ts (same file is excluded from scanning)'
  );
  process.exit(1);
}

console.log('Public surface check passed.');
