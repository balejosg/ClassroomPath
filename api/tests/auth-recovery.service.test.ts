import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as authRecoveryService from '../src/services/auth-recovery.service.js';

describe('auth-recovery service', () => {
  it('exposes the tenant reset-token use-case', () => {
    assert.equal(typeof authRecoveryService.generateTenantResetToken, 'function');
  });
});
