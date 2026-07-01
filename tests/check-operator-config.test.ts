import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { evaluateOperatorConfig, OPERATOR_CONFIG_VARS } from '../scripts/check-operator-config.mjs';

// Mirrors the real operator vars needed for a full production promotion (staging + production +
// windows pre-promotion evidence), so tests can start from a known-complete baseline and remove
// individual keys to simulate gaps.
const COMPLETE_ENV = {
  CLASSROOMPATH_DEPLOY_ROOT: '/srv/classroompath',
  STAGING_HOST: 'staging-host.internal',
  STAGING_USER: 'deploy',
  STAGING_SSH_KEY: '~/.ssh/classroompath_staging',
  DEPLOY_USER: 'deploy',
  PROXMOX_SSH_ALIAS: 'proxmox-alias',
  PROXMOX_HOST: 'proxmox.internal',
  WINDOWS_RUNNER_VMID: '121',
};

test('evaluateOperatorConfig returns empty gaps for a complete env', () => {
  const gaps = evaluateOperatorConfig(COMPLETE_ENV);
  assert.deepEqual(gaps, []);
});

test('evaluateOperatorConfig reports every missing var in one pass, not just the first', () => {
  // Mirrors the T8 incident: PROXMOX_SSH_ALIAS, WINDOWS_RUNNER_VMID, and PROXMOX_HOST were all
  // missing but were discovered one-at-a-time across 3 failed deploy attempts.
  const env = { ...COMPLETE_ENV };
  delete (env as Record<string, string | undefined>).PROXMOX_SSH_ALIAS;
  delete (env as Record<string, string | undefined>).WINDOWS_RUNNER_VMID;
  delete (env as Record<string, string | undefined>).PROXMOX_HOST;

  const gaps = evaluateOperatorConfig(env);
  const names = gaps.map((gap) => gap.name).sort();

  assert.deepEqual(names, ['PROXMOX_HOST', 'PROXMOX_SSH_ALIAS', 'WINDOWS_RUNNER_VMID'].sort());
  assert.ok(gaps.every((gap) => gap.reason === 'missing'));
});

test('evaluateOperatorConfig flags an .example.invalid placeholder value', () => {
  const env = { ...COMPLETE_ENV, DEPLOY_USER: 'deploy' };
  const withPlaceholder = { ...env, STAGING_HOST: 'staging-host.example.invalid' };

  const gaps = evaluateOperatorConfig(withPlaceholder);

  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].name, 'STAGING_HOST');
  assert.equal(gaps[0].reason, 'placeholder');
});

test('evaluateOperatorConfig treats an empty-string value as missing, not placeholder', () => {
  const env = { ...COMPLETE_ENV, DEPLOY_USER: '' };

  const gaps = evaluateOperatorConfig(env);

  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].name, 'DEPLOY_USER');
  assert.equal(gaps[0].reason, 'missing');
});

test('OPERATOR_CONFIG_VARS declares a non-empty required-var set grouped by stage', () => {
  const required = OPERATOR_CONFIG_VARS.filter((entry) => entry.required);
  assert.ok(required.length > 0, 'expected at least one required operator var');

  for (const entry of OPERATOR_CONFIG_VARS) {
    assert.equal(typeof entry.name, 'string');
    assert.equal(typeof entry.stage, 'string');
    assert.equal(typeof entry.required, 'boolean');
    assert.equal(typeof entry.purpose, 'string');
    assert.ok(entry.purpose.length > 0);
  }

  const stages = new Set(OPERATOR_CONFIG_VARS.map((entry) => entry.stage));
  assert.ok(stages.has('staging'));
  assert.ok(stages.has('production'));
  assert.ok(stages.has('windows-evidence'));
});

test('package.json exposes verify:operator-config script', () => {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['verify:operator-config'],
    'node scripts/check-operator-config.mjs'
  );
});
