import assert from 'node:assert';
import { db } from '../../src/db/index.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import * as cpSchema from '../../src/db/schema.js';
import { assertStatus, bearerAuth, parseTRPC, trpcMutate, uniqueEmail } from '../test-utils.js';
import {
  approveOrganizationMember,
  bootstrapOrg,
  ensureOpenPathUser,
  signToken,
  type TestUser,
} from './harness.js';

export interface TestActor extends TestUser {
  token: string;
}

export interface TestOrganization {
  organizationId: string;
  name: string;
}

export interface TestGroup {
  id: string;
  name: string;
  displayName: string;
}

export interface TestClassroom {
  id: string;
  name: string;
  displayName: string;
}

type TestRole = 'admin' | 'teacher' | 'student';

async function throwUnexpectedTrpcStatus(
  action: string,
  response: Response,
  expectedStatus: number
): Promise<never> {
  const body = await response
    .clone()
    .text()
    .catch(() => '<failed to read response body>');
  throw new Error(
    `${action} expected status ${String(expectedStatus)}, got ${String(response.status)}. Body: ${body.slice(0, 800)}`
  );
}

function requireJwtSecret(jwtSecret: string | undefined): string {
  if (!jwtSecret) {
    throw new Error('JWT secret is required to create integration test scenarios');
  }

  return jwtSecret;
}

export function withFrozenDate<T>(date: Date, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  const fixed = date;

  (globalThis as typeof globalThis & { Date: DateConstructor }).Date = class extends RealDate {
    constructor(...args: ConstructorParameters<DateConstructor>) {
      if (args.length === 0) {
        super(fixed.getTime());
      } else {
        super(...args);
      }
    }

    static now(): number {
      return fixed.getTime();
    }

    static parse = RealDate.parse;
    static UTC = RealDate.UTC;
  } as DateConstructor;

  return fn().finally(() => {
    (globalThis as typeof globalThis & { Date: DateConstructor }).Date = RealDate;
  });
}

export function createTenantScenario(params: { baseUrl: string; jwtSecret?: string }) {
  const jwtSecret = requireJwtSecret(params.jwtSecret ?? process.env.JWT_SECRET);

  async function seedOpenPathRole(config: {
    userId: string;
    role: TestRole;
    createdBy: string;
    groupIds?: string[];
  }): Promise<void> {
    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${config.userId}`,
      userId: config.userId,
      role: config.role,
      groupIds: config.groupIds ?? [],
      createdBy: config.createdBy,
    });
  }

  async function createActor(config: {
    userId: string;
    name: string;
    emailPrefix: string;
    roles: unknown[];
  }): Promise<TestActor> {
    const email = uniqueEmail(config.emailPrefix);
    await ensureOpenPathUser({ userId: config.userId, email, name: config.name });
    const token = signToken({
      jwtSecret,
      userId: config.userId,
      email,
      name: config.name,
      roles: config.roles,
    });

    return {
      userId: config.userId,
      email,
      name: config.name,
      token,
    };
  }

  return {
    async createOrgAdmin(config: {
      userId: string;
      name?: string;
      emailPrefix?: string;
      organizationName: string;
    }): Promise<{ actor: TestActor; organization: TestOrganization }> {
      const actor = await createActor({
        userId: config.userId,
        name: config.name ?? 'Admin User',
        emailPrefix: config.emailPrefix ?? 'admin',
        roles: [{ role: 'admin' }],
      });

      const organization = await bootstrapOrg({
        baseUrl: params.baseUrl,
        token: actor.token,
        name: config.organizationName,
      });

      return {
        actor,
        organization: {
          organizationId: organization.organizationId,
          name: config.organizationName,
        },
      };
    },

    async seedOrgAdmin(config: {
      userId: string;
      name?: string;
      emailPrefix?: string;
      organizationName: string;
    }): Promise<{ actor: TestActor; organization: TestOrganization }> {
      const actor = await createActor({
        userId: config.userId,
        name: config.name ?? 'Admin User',
        emailPrefix: config.emailPrefix ?? 'admin',
        roles: [{ role: 'admin', groupIds: [] }],
      });
      const organizationId = `org-${actor.userId}`;

      await db.insert(cpSchema.cpOrganizations).values({
        id: organizationId,
        name: config.organizationName,
        createdBy: actor.userId,
      });
      await db.insert(cpSchema.cpMemberships).values({
        id: `mem-${actor.userId}`,
        userId: actor.userId,
        organizationId,
        role: 'admin',
        invitedBy: actor.userId,
      });
      await seedOpenPathRole({
        userId: actor.userId,
        role: 'admin',
        createdBy: actor.userId,
      });

      return {
        actor,
        organization: {
          organizationId,
          name: config.organizationName,
        },
      };
    },

    async seedMember(config: {
      organizationId: string;
      invitedBy: string;
      role: TestRole;
      userId: string;
      name?: string;
      emailPrefix?: string;
      groupIds?: string[];
    }): Promise<TestActor> {
      const actor = await createActor({
        userId: config.userId,
        name:
          config.name ??
          (config.role === 'teacher'
            ? 'Teacher User'
            : config.role === 'student'
              ? 'Student User'
              : 'Admin User'),
        emailPrefix: config.emailPrefix ?? config.role,
        roles: [
          {
            role: config.role,
            groupIds: config.groupIds ?? [],
          },
        ],
      });

      await db.insert(cpSchema.cpMemberships).values({
        id: `mem-${actor.userId}`,
        userId: actor.userId,
        organizationId: config.organizationId,
        role: config.role,
        invitedBy: config.invitedBy,
      });
      await seedOpenPathRole({
        userId: actor.userId,
        role: config.role,
        createdBy: config.invitedBy,
        groupIds: config.groupIds,
      });

      return actor;
    },

    async addTeacher(config: {
      adminToken: string;
      organizationId: string;
      userId: string;
      name?: string;
      emailPrefix?: string;
      groupIds?: string[];
    }): Promise<TestActor> {
      const actor = await createActor({
        userId: config.userId,
        name: config.name ?? 'Teacher User',
        emailPrefix: config.emailPrefix ?? 'teacher',
        roles: [{ role: 'teacher', groupIds: config.groupIds ?? [] }],
      });

      await approveOrganizationMember({
        baseUrl: params.baseUrl,
        adminToken: config.adminToken,
        memberToken: actor.token,
        memberUserId: actor.userId,
        organizationId: config.organizationId,
        role: 'teacher',
      });

      return actor;
    },

    async addStudent(config: {
      invitedBy: string;
      organizationId: string;
      userId: string;
      name?: string;
      emailPrefix?: string;
    }): Promise<TestActor> {
      const actor = await createActor({
        userId: config.userId,
        name: config.name ?? 'Student User',
        emailPrefix: config.emailPrefix ?? 'student',
        roles: [{ role: 'student' }],
      });

      await db.insert(cpSchema.cpMemberships).values({
        id: `mem-${actor.userId}`,
        userId: actor.userId,
        organizationId: config.organizationId,
        role: 'student',
        invitedBy: config.invitedBy,
      });

      return actor;
    },

    async createGroup(config: {
      token: string;
      name: string;
      displayName?: string;
    }): Promise<TestGroup> {
      const displayName = config.displayName ?? config.name;
      const response = await trpcMutate(
        params.baseUrl,
        'groups.create',
        { name: config.name, displayName },
        bearerAuth(config.token)
      );
      if (response.status !== 200) {
        await throwUnexpectedTrpcStatus('groups.create', response, 200);
      }
      const { data } = (await parseTRPC(response)) as { data: { id?: unknown; name?: unknown } };
      assert.ok(data?.id, 'groups.create should return id');

      return {
        id: String(data.id),
        name: String(data.name ?? config.name),
        displayName,
      };
    },

    async updateGroup(config: {
      token: string;
      id: string;
      enabled?: boolean;
      visibility?: 'private' | 'instance_public';
      displayName?: string;
    }): Promise<void> {
      const response = await trpcMutate(
        params.baseUrl,
        'groups.update',
        {
          id: config.id,
          enabled: config.enabled,
          visibility: config.visibility,
          displayName: config.displayName,
        },
        bearerAuth(config.token)
      );
      assertStatus(response, 200);
    },

    async createClassroom(config: {
      token: string;
      name: string;
      displayName?: string;
      defaultGroupId?: string;
    }): Promise<TestClassroom> {
      const displayName = config.displayName ?? config.name;
      const response = await trpcMutate(
        params.baseUrl,
        'classrooms.create',
        {
          name: config.name,
          displayName,
          defaultGroupId: config.defaultGroupId,
        },
        bearerAuth(config.token)
      );
      if (response.status !== 200) {
        await throwUnexpectedTrpcStatus('classrooms.create', response, 200);
      }
      const { data } = (await parseTRPC(response)) as { data: { id?: unknown; name?: unknown } };
      assert.ok(data?.id, 'classrooms.create should return id');

      return {
        id: String(data.id),
        name: String(data.name ?? config.name),
        displayName,
      };
    },

    withFrozenDate,
  };
}
