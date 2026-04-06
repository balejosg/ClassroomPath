import assert from 'node:assert/strict';
import test from 'node:test';

import {
  E2E_WORKER_ACCOUNT_COUNT,
  E2E_WORKER_STATE_VARIANTS,
  createTestOrganization,
  createTestUser,
  getDefaultTenantActorName,
  getSeededE2EBaseUser,
  getWorkerScopedSeededE2EUser,
  listSeededE2EUsers,
} from './test-actors.js';

test('shared test actor helpers expose stable tenant defaults', () => {
  assert.equal(getDefaultTenantActorName('admin'), 'Admin User');
  assert.equal(getDefaultTenantActorName('teacher'), 'Teacher User');
  assert.equal(getDefaultTenantActorName('student'), 'Student User');
});

test('worker-scoped seeded users keep deterministic ids and emails', () => {
  const admin = getWorkerScopedSeededE2EUser('admin', 0, 3);
  const pending = getWorkerScopedSeededE2EUser('pending', 7, 2);

  assert.equal(admin.id, 'usr_admin_e2e_w3');
  assert.equal(admin.email, 'admin+w3@classroompath.test');
  assert.equal(pending.id, 'usr_pending_e2e_w2_v8');
  assert.equal(pending.email, 'pending+w2-v8@classroompath.test');
  assert.equal(pending.status, 'waiting');
});

test('seed inventory includes base actors and worker-scoped variants', () => {
  const seededUsers = listSeededE2EUsers();
  const baseAdmin = getSeededE2EBaseUser('admin');
  const workerAdminCount = seededUsers.filter(
    (user) => user.kind === 'admin' && user.workerSlot
  ).length;
  const workerPendingCount = seededUsers.filter(
    (user) => user.kind === 'pending' && user.workerSlot
  ).length;

  assert.ok(seededUsers.some((user) => user.id === baseAdmin.id && !user.workerSlot));
  assert.equal(workerAdminCount, E2E_WORKER_ACCOUNT_COUNT);
  assert.equal(workerPendingCount, E2E_WORKER_ACCOUNT_COUNT * E2E_WORKER_STATE_VARIANTS);
});

test('runtime-generated users and organizations carry the worker scope', () => {
  const originalWorkerIndex = process.env.TEST_WORKER_INDEX;
  process.env.TEST_WORKER_INDEX = '1';

  try {
    const user = createTestUser();
    const organization = createTestOrganization();

    assert.match(user.email, /^test-w2-/);
    assert.match(user.name, /^E2E User W2 /);
    assert.match(organization.name, /^E2E Organization W2 /);
  } finally {
    if (originalWorkerIndex === undefined) {
      delete process.env.TEST_WORKER_INDEX;
    } else {
      process.env.TEST_WORKER_INDEX = originalWorkerIndex;
    }
  }
});
