import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as authRegistrationService from '../src/services/auth-registration.service.js';

describe('auth-registration service', () => {
  it('exposes the self-service auth use-cases', () => {
    assert.deepEqual(Object.keys(authRegistrationService).sort(), [
      'generateEmailVerificationDelivery',
      'registerSelfServiceUser',
      'signUpWithGoogle',
    ]);
  });
});
