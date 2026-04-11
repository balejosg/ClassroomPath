import { db } from '../../src/db/index.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import * as cpSchema from '../../src/db/schema.js';
import { assertStatus, bearerAuth, trpcMutate, uniqueEmail } from '../test-utils.js';
import {
  approveOrganizationMember,
  bootstrapOrg,
  ensureOpenPathUser,
  signToken,
  type TestUser,
} from './harness.js';
import {
  getDefaultTenantActorName,
  getDefaultTenantEmailPrefix,
  type TenantActorRole,
} from '@classroompath/testkit/test-actors';
import { createTenantApiHarness } from '@classroompath/testkit/tenant-api-harness';

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

type TestRole = TenantActorRole;

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
        name: config.name ?? getDefaultTenantActorName('admin'),
        emailPrefix: config.emailPrefix ?? getDefaultTenantEmailPrefix('admin'),
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
        name: config.name ?? getDefaultTenantActorName('admin'),
        emailPrefix: config.emailPrefix ?? getDefaultTenantEmailPrefix('admin'),
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
      await db.insert(cpSchema.cpOrganizationEntitlements).values({
        organizationId,
        source: 'manual_admin',
        status: 'active',
        productKind: 'annual',
        classroomLimit: 100,
        grantedBy: actor.userId,
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
        name: config.name ?? getDefaultTenantActorName(config.role),
        emailPrefix: config.emailPrefix ?? getDefaultTenantEmailPrefix(config.role),
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
        name: config.name ?? getDefaultTenantActorName('teacher'),
        emailPrefix: config.emailPrefix ?? getDefaultTenantEmailPrefix('teacher'),
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
        name: config.name ?? getDefaultTenantActorName('student'),
        emailPrefix: config.emailPrefix ?? getDefaultTenantEmailPrefix('student'),
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
      return createTenantApiHarness({
        baseUrl: params.baseUrl,
        token: config.token,
      }).createGroup(config);
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
      const classroom = await createTenantApiHarness({
        baseUrl: params.baseUrl,
        token: config.token,
      }).createClassroom(config);

      return {
        id: classroom.id,
        name: classroom.name,
        displayName: classroom.displayName,
      };
    },

    withFrozenDate,
  };
}
