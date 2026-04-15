import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLASSROOMPATH_TEST_RESET_TABLES,
  OPENPATH_TEST_RESET_TABLES,
} from '../src/db/test-table-inventory.js';

describe('test table inventory', () => {
  it('defines the canonical ClassroomPath reset tables', () => {
    assert.deepStrictEqual(CLASSROOMPATH_TEST_RESET_TABLES, [
      'cp_stripe_webhook_events',
      'cp_billing_manual_requests',
      'cp_organization_entitlements',
      'cp_billing_checkout_intents',
      'cp_billing_audit_events',
      'cp_mutation_operations',
      'cp_audit_events',
      'cp_organization_groups',
      'cp_organization_classrooms',
      'cp_invitations',
      'cp_terms_acceptance',
      'cp_group_template_rules',
      'cp_group_templates',
      'cp_memberships',
      'cp_organizations',
      'cp_user_status',
    ]);
  });

  it('defines the canonical OpenPath reset tables', () => {
    assert.deepStrictEqual(OPENPATH_TEST_RESET_TABLES, [
      'whitelist_rules',
      'whitelist_groups',
      'users',
      'roles',
      'tokens',
      'email_verification_tokens',
      'classrooms',
      'schedules',
      'requests',
      'machines',
      'settings',
    ]);
  });
});
