// @ts-nocheck
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { router, tenantProcedure } from '../trpc.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import {
  openpathDb,
  schedules,
  classrooms,
  notifyOpenPathClassroomChanged,
} from '../../db/openpath.js';

function isAdminToken(user: any): boolean {
  const roles = user?.roles ?? [];
  return roles.some((r: any) => r?.role === 'admin');
}

function canApproveGroup(user: any, groupId: string): boolean {
  if (isAdminToken(user)) return true;
  const roles = user?.roles ?? [];
  return roles.some(
    (r: any) => r?.role === 'teacher' && Array.isArray(r?.groupIds) && r.groupIds.includes(groupId)
  );
}

function normalizeTime(t: string): string {
  const parts = t.split(':');
  const hh = parts[0];
  const mm = parts[1];
  if (hh !== undefined && mm !== undefined) return `${hh}:${mm}`;
  return t;
}

function parseTimeToMinutes(t: string): number {
  const [hh, mm] = t.split(':');
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return NaN;
  return h * 60 + m;
}

function assertQuarterHour(t: string, field: string): void {
  const minutes = parseTimeToMinutes(t);
  if (!Number.isFinite(minutes)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${field} must be a valid time` });
  }
  const m = minutes % 60;
  if (m % 15 !== 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${field} must be in 15-minute increments`,
    });
  }
}

async function assertOrgClassroomAccess(
  organizationId: string,
  classroomId: string
): Promise<void> {
  const orgClassroom = await db
    .select()
    .from(schema.cpOrganizationClassrooms)
    .where(
      and(
        eq(schema.cpOrganizationClassrooms.organizationId, organizationId),
        eq(schema.cpOrganizationClassrooms.classroomId, classroomId)
      )
    )
    .limit(1);

  if (!orgClassroom.length) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found or access denied' });
  }
}

async function assertOrgGroupAccess(organizationId: string, groupId: string): Promise<void> {
  const orgGroup = await db
    .select()
    .from(schema.cpOrganizationGroups)
    .where(
      and(
        eq(schema.cpOrganizationGroups.organizationId, organizationId),
        eq(schema.cpOrganizationGroups.groupId, groupId)
      )
    )
    .limit(1);

  if (!orgGroup.length) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found or access denied' });
  }
}

async function assertNoConflict(params: {
  classroomId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  excludeId?: string;
}): Promise<void> {
  const { classroomId, dayOfWeek, startTime, endTime, excludeId } = params;

  const clauses: any[] = [
    eq(schedules.classroomId, classroomId),
    eq(schedules.dayOfWeek, dayOfWeek),
    sql`(${startTime}::time, ${endTime}::time) OVERLAPS (${schedules.startTime}, ${schedules.endTime})`,
  ];

  if (excludeId) {
    clauses.push(sql`${schedules.id} != ${excludeId}::uuid`);
  }

  const conflicts = await openpathDb
    .select({ id: schedules.id })
    .from(schedules)
    .where(and(...clauses))
    .limit(1);

  if (conflicts.length) {
    throw new TRPCError({ code: 'CONFLICT', message: 'This time slot is already reserved' });
  }
}

function requireTeacherOrAdmin(ctx: any): void {
  const role = ctx.userRole;
  if (role !== 'admin' && role !== 'teacher') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Teacher access required' });
  }
}

const CreateScheduleSchema = z.object({
  classroomId: z.string().min(1),
  groupId: z.string().min(1),
  dayOfWeek: z.number().int().min(1).max(5),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
});

const UpdateScheduleSchema = z.object({
  id: z.string().min(1),
  dayOfWeek: z.number().int().min(1).max(5).optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  groupId: z.string().min(1).optional(),
});

export const schedulesRouter = router({
  getByClassroom: tenantProcedure
    .input(z.object({ classroomId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      await assertOrgClassroomAccess(ctx.organizationId!, input.classroomId);

      const classroom = await openpathDb
        .select()
        .from(classrooms)
        .where(eq(classrooms.id, input.classroomId))
        .limit(1);

      if (!classroom[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found' });
      }

      const rows = await openpathDb
        .select()
        .from(schedules)
        .where(eq(schedules.classroomId, input.classroomId))
        .orderBy(schedules.dayOfWeek, schedules.startTime);

      const userId = ctx.user.sub;
      const admin = isAdminToken(ctx.user);

      return {
        classroom: {
          id: classroom[0].id,
          name: classroom[0].name,
          displayName: classroom[0].displayName,
        },
        schedules: rows.map((s: any) => ({
          id: s.id,
          classroomId: s.classroomId,
          dayOfWeek: s.dayOfWeek,
          startTime: normalizeTime(s.startTime),
          endTime: normalizeTime(s.endTime),
          groupId: s.groupId,
          teacherId: s.teacherId,
          recurrence: s.recurrence ?? 'weekly',
          createdAt: s.createdAt?.toISOString?.() ?? null,
          updatedAt: s.updatedAt?.toISOString?.() ?? null,
          isMine: s.teacherId === userId,
          canEdit: s.teacherId === userId || admin,
        })),
      };
    }),

  getMine: tenantProcedure.query(async ({ ctx }) => {
    requireTeacherOrAdmin(ctx);

    const orgClassrooms = await db
      .select()
      .from(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!));

    const classroomIds = orgClassrooms.map((oc) => oc.classroomId);
    if (classroomIds.length === 0) return [];

    const rows = await openpathDb
      .select()
      .from(schedules)
      .where(
        and(eq(schedules.teacherId, ctx.user.sub), inArray(schedules.classroomId, classroomIds))
      )
      .orderBy(schedules.dayOfWeek, schedules.startTime);

    return rows.map((s: any) => ({
      id: s.id,
      classroomId: s.classroomId,
      dayOfWeek: s.dayOfWeek,
      startTime: normalizeTime(s.startTime),
      endTime: normalizeTime(s.endTime),
      groupId: s.groupId,
      teacherId: s.teacherId,
      recurrence: s.recurrence ?? 'weekly',
      createdAt: s.createdAt?.toISOString?.() ?? null,
      updatedAt: s.updatedAt?.toISOString?.() ?? null,
    }));
  }),

  create: tenantProcedure.input(CreateScheduleSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);

    await assertOrgClassroomAccess(ctx.organizationId!, input.classroomId);
    await assertOrgGroupAccess(ctx.organizationId!, input.groupId);

    if (!canApproveGroup(ctx.user, input.groupId)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You can only create schedules for your assigned groups',
      });
    }

    assertQuarterHour(input.startTime, 'startTime');
    assertQuarterHour(input.endTime, 'endTime');
    const start = parseTimeToMinutes(input.startTime);
    const end = parseTimeToMinutes(input.endTime);
    if (!(start < end)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'startTime must be before endTime' });
    }

    await assertNoConflict({
      classroomId: input.classroomId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
    });

    const [created] = await openpathDb
      .insert(schedules)
      .values({
        classroomId: input.classroomId,
        teacherId: ctx.user.sub,
        groupId: input.groupId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime as any,
        endTime: input.endTime as any,
        recurrence: 'weekly',
      } as any)
      .returning();

    await notifyOpenPathClassroomChanged(created.classroomId);

    return {
      id: created.id,
      classroomId: created.classroomId,
      dayOfWeek: created.dayOfWeek,
      startTime: normalizeTime(created.startTime),
      endTime: normalizeTime(created.endTime),
      groupId: created.groupId,
      teacherId: created.teacherId,
      recurrence: created.recurrence ?? 'weekly',
      createdAt: created.createdAt?.toISOString?.() ?? null,
      updatedAt: created.updatedAt?.toISOString?.() ?? null,
    };
  }),

  update: tenantProcedure.input(UpdateScheduleSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);

    const existing = await openpathDb
      .select()
      .from(schedules)
      .where(eq(schedules.id, input.id as any))
      .limit(1);

    if (!existing[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
    }

    await assertOrgClassroomAccess(ctx.organizationId!, existing[0].classroomId);

    const admin = isAdminToken(ctx.user);
    const isOwner = existing[0].teacherId === ctx.user.sub;
    if (!admin && !isOwner) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only manage your own schedules' });
    }

    const nextDayOfWeek = input.dayOfWeek ?? existing[0].dayOfWeek;
    const nextStart = input.startTime ?? normalizeTime(existing[0].startTime);
    const nextEnd = input.endTime ?? normalizeTime(existing[0].endTime);
    const nextGroupId = input.groupId ?? existing[0].groupId;

    await assertOrgGroupAccess(ctx.organizationId!, nextGroupId);

    if (input.groupId !== undefined && input.groupId !== existing[0].groupId) {
      if (!canApproveGroup(ctx.user, input.groupId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only use your assigned groups',
        });
      }
    }

    assertQuarterHour(nextStart, 'startTime');
    assertQuarterHour(nextEnd, 'endTime');
    const start = parseTimeToMinutes(nextStart);
    const end = parseTimeToMinutes(nextEnd);
    if (!(start < end)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'startTime must be before endTime' });
    }

    await assertNoConflict({
      classroomId: existing[0].classroomId,
      dayOfWeek: nextDayOfWeek,
      startTime: nextStart,
      endTime: nextEnd,
      excludeId: input.id,
    });

    const [updated] = await openpathDb
      .update(schedules)
      .set({
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime as any,
        endTime: input.endTime as any,
        groupId: input.groupId,
        updatedAt: new Date(),
      } as any)
      .where(eq(schedules.id, input.id as any))
      .returning();

    await notifyOpenPathClassroomChanged(updated.classroomId);

    return {
      id: updated.id,
      classroomId: updated.classroomId,
      dayOfWeek: updated.dayOfWeek,
      startTime: normalizeTime(updated.startTime),
      endTime: normalizeTime(updated.endTime),
      groupId: updated.groupId,
      teacherId: updated.teacherId,
      recurrence: updated.recurrence ?? 'weekly',
      createdAt: updated.createdAt?.toISOString?.() ?? null,
      updatedAt: updated.updatedAt?.toISOString?.() ?? null,
    };
  }),

  delete: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      const existing = await openpathDb
        .select()
        .from(schedules)
        .where(eq(schedules.id, input.id as any))
        .limit(1);

      if (!existing[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }

      await assertOrgClassroomAccess(ctx.organizationId!, existing[0].classroomId);

      const admin = isAdminToken(ctx.user);
      const isOwner = existing[0].teacherId === ctx.user.sub;
      if (!admin && !isOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only manage your own schedules',
        });
      }

      await openpathDb.delete(schedules).where(eq(schedules.id, input.id as any));

      await notifyOpenPathClassroomChanged(existing[0].classroomId);
      return { success: true };
    }),
});
