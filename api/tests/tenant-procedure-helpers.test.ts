import { describe, it } from 'node:test';
import assert from 'node:assert';

import { TRPCError } from '@trpc/server';

import type { Context } from '../src/trpc/context.js';
import {
  assertOrgAdminTenantProcedureContext,
  assertTeacherOrAdminTenantProcedureContext,
  assertTenantProcedureContext,
} from '../src/trpc/tenant-procedure-helpers.js';

function assertTrpcError(err: unknown, expectedCode: string, expectedMessage?: string): void {
  assert.ok(err instanceof TRPCError);
  assert.strictEqual(err.code, expectedCode);
  if (expectedMessage !== undefined) {
    assert.strictEqual(err.message, expectedMessage);
  }
}

const baseUser = {
  sub: 'tenant-test-user',
  email: 'tenant@test.local',
  name: 'Tenant Test',
  roles: [],
};

const stubReq = {} as Context['req'];
const stubRes = {} as Context['res'];

describe('tenant-procedure-helpers', () => {
  it('assertTenantProcedureContext accepts tenant procedure contexts', () => {
    assertTenantProcedureContext({
      user: baseUser,
      token: 'jwt',
      req: stubReq,
      res: stubRes,
      organizationId: 'org_123',
      userRole: 'teacher',
    });
  });

  it('assertTenantProcedureContext rejects missing tenant metadata', () => {
    try {
      assertTenantProcedureContext({
        user: baseUser,
        token: 'jwt',
        req: stubReq,
        res: stubRes,
      });
      assert.fail('expected missing tenant context to throw');
    } catch (err) {
      assertTrpcError(err, 'FORBIDDEN', 'Missing tenant context');
    }
  });

  it('assertTeacherOrAdminTenantProcedureContext enforces elevated tenant roles', () => {
    assertTeacherOrAdminTenantProcedureContext({
      user: baseUser,
      token: 'jwt',
      req: stubReq,
      res: stubRes,
      organizationId: 'org_123',
      userRole: 'admin',
    });

    assertTeacherOrAdminTenantProcedureContext({
      user: baseUser,
      token: 'jwt',
      req: stubReq,
      res: stubRes,
      organizationId: 'org_123',
      userRole: 'teacher',
    });

    try {
      assertTeacherOrAdminTenantProcedureContext({
        user: baseUser,
        token: 'jwt',
        req: stubReq,
        res: stubRes,
        organizationId: 'org_123',
        userRole: 'student',
      });
      assert.fail('expected student tenant role to throw');
    } catch (err) {
      assertTrpcError(err, 'FORBIDDEN', 'Teacher access required');
    }
  });

  it('assertOrgAdminTenantProcedureContext enforces admin role with custom message', () => {
    assertOrgAdminTenantProcedureContext(
      {
        user: baseUser,
        token: 'jwt',
        req: stubReq,
        res: stubRes,
        organizationId: 'org_123',
        userRole: 'admin',
      },
      'Only organization admins can manage users'
    );

    try {
      assertOrgAdminTenantProcedureContext(
        {
          user: baseUser,
          token: 'jwt',
          req: stubReq,
          res: stubRes,
          organizationId: 'org_123',
          userRole: 'teacher',
        },
        'Only organization admins can manage users'
      );
      assert.fail('expected non-admin tenant role to throw');
    } catch (err) {
      assertTrpcError(err, 'FORBIDDEN', 'Only organization admins can manage users');
    }
  });
});
