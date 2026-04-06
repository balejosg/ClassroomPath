import assert from 'node:assert/strict';
import test from 'node:test';

import { actorToTestUser, createSessionActorCatalog } from './actors.js';

test('session actor catalog returns typed seeded actors', () => {
  const actors = createSessionActorCatalog();
  const admin = actors.admin();
  const teacher = actors.teacher();
  const pending = actors.pending(2);
  const onboarding = actors.onboarding(4);

  assert.equal(admin.kind, 'admin');
  assert.equal(teacher.kind, 'teacher');
  assert.equal(pending.kind, 'pending');
  assert.equal(onboarding.kind, 'onboarding');
  assert.match(admin.email, /^admin\+w\d+@classroompath\.test$/);
  assert.match(pending.email, /^pending\+w\d+-v3@classroompath\.test$/);
  assert.match(onboarding.email, /^onboarding\+w\d+-v5@classroompath\.test$/);
});

test('actorToTestUser strips actor-only metadata', () => {
  const actor = createSessionActorCatalog().pending(1);

  assert.deepEqual(actorToTestUser(actor), {
    email: actor.email,
    password: actor.password,
    name: actor.name,
  });
});
