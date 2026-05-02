#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const value = process.argv[index + 1]?.startsWith('--') ? '1' : (process.argv[++index] ?? '1');
  args.set(key, value);
}

const manifestPath = resolve(
  process.cwd(),
  args.get('manifest') ?? 'config/staging-qa-fixtures.json'
);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (manifest.environment !== 'staging') {
  throw new Error(`Refusing to generate QA fixture SQL for environment=${manifest.environment}`);
}

const classroomId = requireString(manifest.classroomId, 'classroomId');
const groupFixtures = new Map(
  (manifest.fixtures ?? []).map((fixture) => [
    slugify(requireString(fixture.group, 'group')),
    fixture,
  ])
);

if (groupFixtures.size === 0) {
  throw new Error('Manifest must include at least one fixture group');
}

const values = [];
for (const [groupSlug, fixture] of groupFixtures) {
  const rules = [
    { type: 'whitelist', value: hostFromUrl(fixture.allowed) },
    { type: 'whitelist', value: hostFromUrl(fixture.allowedAjax) },
    {
      type: 'whitelist',
      value: hostFromHostPath(requireString(fixture.blockedPath, `${fixture.group}.blockedPath`)),
    },
    {
      type: 'blocked_subdomain',
      value: normalizeHostname(
        requireString(fixture.blockedSubdomain, `${fixture.group}.blockedSubdomain`)
      ),
    },
    {
      type: 'blocked_path',
      value: normalizeHostPath(requireString(fixture.blockedPath, `${fixture.group}.blockedPath`)),
    },
  ];

  for (const rule of dedupeRules(rules)) {
    values.push({
      groupSlug,
      type: rule.type,
      value: rule.value,
      comment: `Staging QA fixture for ${fixture.group}`,
    });
  }
}

process.stdout.write(
  `${renderSql({ classroomId, groupSlugs: [...groupFixtures.keys()], values })}\n`
);

function renderSql({ classroomId, groupSlugs, values }) {
  return `BEGIN;

WITH target_groups AS (
  SELECT id, lower(regexp_replace(name, '^.*-', '')) AS fixture_group
  FROM whitelist_groups
  WHERE id IN (
    SELECT default_group_id FROM classrooms WHERE id = ${sqlString(classroomId)}
    UNION
    SELECT active_group_id FROM classrooms WHERE id = ${sqlString(classroomId)}
  )
  OR id IN (
    SELECT group_id
    FROM schedules
    WHERE classroom_id = ${sqlString(classroomId)}
  )
  OR name LIKE 'stage-20260502-t%-%'
),
matched_groups AS (
  SELECT id, fixture_group
  FROM target_groups
  WHERE fixture_group IN (${groupSlugs.map(sqlString).join(', ')})
),
deleted AS (
  DELETE FROM whitelist_rules
  WHERE group_id IN (SELECT id FROM matched_groups)
  RETURNING group_id
),
deleted_count AS (
  SELECT count(*) AS deleted_rules FROM deleted
),
fixture_rules(fixture_group, type, value, comment) AS (
  VALUES
${values
  .map(
    (rule) =>
      `    (${sqlString(rule.groupSlug)}, ${sqlString(rule.type)}, ${sqlString(rule.value)}, ${sqlString(rule.comment)})`
  )
  .join(',\n')}
)
INSERT INTO whitelist_rules (id, group_id, type, value, comment, source)
SELECT
  'qa_' || substr(md5(matched_groups.id || ':' || fixture_rules.type || ':' || fixture_rules.value), 1, 29),
  matched_groups.id,
  fixture_rules.type,
  fixture_rules.value,
  fixture_rules.comment,
  'seed'
FROM matched_groups
JOIN fixture_rules USING (fixture_group)
CROSS JOIN deleted_count
ON CONFLICT (group_id, type, value) DO UPDATE
SET comment = EXCLUDED.comment,
    source = EXCLUDED.source;

COMMIT;
`;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing ${label}`);
  }
  return value.trim();
}

function hostFromUrl(value) {
  const url = new URL(requireString(value, 'url'));
  return normalizeHostname(url.hostname);
}

function normalizeHostname(value) {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function normalizeHostPath(value) {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const url = new URL(trimmed);
    return `${normalizeHostname(url.hostname)}${url.pathname}`;
  }
  const slash = trimmed.indexOf('/');
  if (slash < 1) {
    throw new Error(`Expected host/path rule, got ${value}`);
  }
  return `${normalizeHostname(trimmed.slice(0, slash))}${trimmed.slice(slash)}`;
}

function hostFromHostPath(value) {
  return normalizeHostname(normalizeHostPath(value).split('/')[0] ?? '');
}

function dedupeRules(rules) {
  const seen = new Set();
  return rules.filter((rule) => {
    const key = `${rule.type}:${rule.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
