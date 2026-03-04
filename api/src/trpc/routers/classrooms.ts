// @ts-nocheck
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, tenantProcedure } from '../trpc.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and, sql, gt } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  openpathDb,
  notifyOpenPathClassroomChanged,
  classrooms,
  machines,
  schedules,
  machineExemptions,
} from '../../db/openpath.js';

import {
  assertCanUseGroup,
  assertOrgClassroomAccess,
  assertOrgGroupAccess,
  requireTeacherOrAdmin,
} from '../../lib/tenant-access.js';

const CLASSROOM_SCOPE_PREFIX = 'cp';

// Scheduling uses dayOfWeek + start/end times without timezone.
// To make "current schedule" deterministic in Docker (which often defaults to UTC),
// we compute "now" in an explicit timezone.
const SCHEDULE_TIMEZONE = process.env.SCHEDULE_TIMEZONE || process.env.TZ || 'Europe/Madrid';

const WEEKDAY_BY_SHORT_EN: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getScheduleClock(date: Date): { dayOfWeek: number; timeHHMM: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: SCHEDULE_TIMEZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hourPartRaw = parts.find((p) => p.type === 'hour')?.value;
    const minutePart = parts.find((p) => p.type === 'minute')?.value;

    const dayOfWeek =
      weekday && WEEKDAY_BY_SHORT_EN[weekday] !== undefined
        ? WEEKDAY_BY_SHORT_EN[weekday]
        : date.getDay();
    const hourPart = hourPartRaw === '24' ? '00' : hourPartRaw;
    const timeHHMM =
      hourPart && minutePart ? `${hourPart}:${minutePart}` : date.toTimeString().slice(0, 5);

    return { dayOfWeek, timeHHMM };
  } catch {
    return { dayOfWeek: date.getDay(), timeHHMM: date.toTimeString().slice(0, 5) };
  }
}

type MachineStatus = 'online' | 'stale' | 'offline';
type ClassroomStatus = 'operational' | 'degraded' | 'offline';

// Thresholds (must match OpenPath classroom.service.ts)
const ONLINE_THRESHOLD_MINUTES = 5;
const STALE_THRESHOLD_MINUTES = 15;

function calculateMachineStatus(lastSeen: Date | null): MachineStatus {
  if (!lastSeen) return 'offline';
  const now = new Date();
  const diffMs = now.getTime() - lastSeen.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  if (diffMinutes <= ONLINE_THRESHOLD_MINUTES) return 'online';
  if (diffMinutes <= STALE_THRESHOLD_MINUTES) return 'stale';
  return 'offline';
}

function calculateClassroomStatus(machinesList: { status: MachineStatus }[]): ClassroomStatus {
  if (machinesList.length === 0) return 'operational';

  const onlineCount = machinesList.filter((m) => m.status === 'online').length;
  const offlineCount = machinesList.filter((m) => m.status === 'offline').length;

  if (onlineCount === machinesList.length) return 'operational';
  if (offlineCount === machinesList.length) return 'offline';
  return 'degraded';
}

function normalizeTimeHHMM(t: string): string {
  const parts = String(t).split(':');
  const hh = parts[0];
  const mm = parts[1];
  if (hh !== undefined && mm !== undefined) return `${hh}:${mm}`;
  return String(t);
}

function parseTimeToMinutes(t: string): number {
  const parts = String(t).split(':');
  const hh = parts[0];
  const mm = parts[1];
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function normalizeClassroomKey(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function scopedClassroomNameForOrg(organizationId: string, publicName: string): string {
  const normalized = normalizeClassroomKey(publicName);

  if (!normalized) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Classroom name must include at least one letter or number',
    });
  }

  const orgHash = createHash('sha256').update(organizationId).digest('hex').slice(0, 10);
  const nameHash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  const prefix = `${CLASSROOM_SCOPE_PREFIX}-${orgHash}-`;
  const suffix = `-${nameHash}`;
  const maxBaseLength = Math.max(1, 100 - prefix.length - suffix.length);
  const base = normalized.slice(0, maxBaseLength);

  return `${prefix}${base}${suffix}`;
}

function toPublicClassroomName(classroom: { name: string; displayName: string | null }): string {
  const displayName = classroom.displayName?.trim();
  if (displayName) {
    return displayName;
  }

  const scopedMatch = classroom.name.match(/^cp-[a-f0-9]{10}-(.*)-[a-f0-9]{8}$/);
  return scopedMatch?.[1] ?? classroom.name;
}

async function getCurrentScheduleGroupId(params: {
  classroomId: string;
  date?: Date | undefined;
}): Promise<string | null> {
  const date = params.date ?? new Date();
  const { dayOfWeek, timeHHMM } = getScheduleClock(date);

  // Only Mon-Fri scheduling is supported
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  const currentTime = timeHHMM;

  const rows = await openpathDb
    .select({ groupId: schedules.groupId })
    .from(schedules)
    .where(
      and(
        eq(schedules.classroomId, params.classroomId),
        eq(schedules.dayOfWeek, dayOfWeek),
        sql`${schedules.startTime} <= ${currentTime}::time`,
        sql`${schedules.endTime} > ${currentTime}::time`
      )
    )
    .limit(1);

  return rows[0]?.groupId ?? null;
}

const CreateClassroomSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(255).optional(),
  defaultGroupId: z.string().optional(),
});

const UpdateClassroomSchema = z.object({
  id: z.string(),
  displayName: z.string().min(1).max(255).optional(),
  defaultGroupId: z.string().optional(),
});

export const classroomsRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    const orgClassrooms = await db
      .select()
      .from(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!));

    const classroomIds = orgClassrooms.map((oc) => oc.classroomId);

    if (classroomIds.length === 0) return [];

    const result = await openpathDb
      .select()
      .from(classrooms)
      .where(inArray(classrooms.id, classroomIds));

    const now = new Date();
    const { dayOfWeek: nowDayOfWeek, timeHHMM: nowTime } = getScheduleClock(now);

    const scheduleGroupByClassroomId = new Map<string, string>();
    if (nowDayOfWeek !== 0 && nowDayOfWeek !== 6) {
      const activeScheduleRows = await openpathDb
        .select({ classroomId: schedules.classroomId, groupId: schedules.groupId })
        .from(schedules)
        .where(
          and(
            inArray(schedules.classroomId, classroomIds),
            eq(schedules.dayOfWeek, nowDayOfWeek),
            sql`${schedules.startTime} <= ${nowTime}::time`,
            sql`${schedules.endTime} > ${nowTime}::time`
          )
        );

      for (const row of activeScheduleRows) {
        if (!scheduleGroupByClassroomId.has(row.classroomId)) {
          scheduleGroupByClassroomId.set(row.classroomId, row.groupId);
        }
      }
    }

    const machineRows = await openpathDb
      .select()
      .from(machines)
      .where(inArray(machines.classroomId, classroomIds));

    const machinesByClassroomId = new Map<string, any[]>();
    for (const m of machineRows) {
      const classroomId = m.classroomId;
      if (!classroomId) continue;

      const status = calculateMachineStatus(m.lastSeen ?? null);
      const item = {
        id: m.id,
        hostname: m.hostname,
        classroomId: m.classroomId,
        version: m.version,
        lastSeen: m.lastSeen?.toISOString?.() ?? null,
        status,
      };

      const list = machinesByClassroomId.get(classroomId) ?? [];
      list.push(item);
      machinesByClassroomId.set(classroomId, list);
    }

    // Serialize Date fields for JSON compatibility
    return result.map((c) => {
      const scheduleGroupId = scheduleGroupByClassroomId.get(c.id) ?? null;
      const currentGroupId = c.activeGroupId ?? scheduleGroupId ?? c.defaultGroupId ?? null;
      const currentGroupSource = c.activeGroupId
        ? 'manual'
        : scheduleGroupId
          ? 'schedule'
          : c.defaultGroupId
            ? 'default'
            : 'none';

      const machinesList = machinesByClassroomId.get(c.id) ?? [];
      const onlineMachineCount = machinesList.filter((m) => m.status === 'online').length;
      const status = calculateClassroomStatus(machinesList);

      return {
        id: c.id,
        name: toPublicClassroomName(c),
        displayName: c.displayName,
        defaultGroupId: c.defaultGroupId,
        activeGroupId: c.activeGroupId,
        currentGroupId,
        currentGroupSource,
        machines: machinesList,
        machineCount: machinesList.length,
        status,
        onlineMachineCount,
        createdAt: c.createdAt?.toISOString() ?? null,
        updatedAt: c.updatedAt?.toISOString() ?? null,
      };
    });
  }),

  getById: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const orgClassroom = await db
      .select()
      .from(schema.cpOrganizationClassrooms)
      .where(
        and(
          eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationClassrooms.classroomId, input.id)
        )
      )
      .limit(1);

    if (!orgClassroom.length) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Classroom not found or access denied',
      });
    }

    const classroom = await openpathDb
      .select()
      .from(classrooms)
      .where(eq(classrooms.id, input.id))
      .limit(1);

    if (!classroom[0]) return null;

    const c = classroom[0];
    const currentScheduleGroupId = await getCurrentScheduleGroupId({ classroomId: c.id });
    const currentGroupId = c.activeGroupId ?? currentScheduleGroupId ?? c.defaultGroupId ?? null;
    const currentGroupSource = c.activeGroupId
      ? 'manual'
      : currentScheduleGroupId
        ? 'schedule'
        : c.defaultGroupId
          ? 'default'
          : 'none';

    // Serialize Date fields for JSON compatibility
    return {
      id: c.id,
      name: toPublicClassroomName(c),
      displayName: c.displayName,
      defaultGroupId: c.defaultGroupId,
      activeGroupId: c.activeGroupId,
      currentGroupId,
      currentGroupSource,
      createdAt: c.createdAt?.toISOString() ?? null,
      updatedAt: c.updatedAt?.toISOString() ?? null,
    };
  }),

  listMachines: tenantProcedure
    .input(z.object({ classroomId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      // Get all classrooms for this organization
      const orgClassrooms = await db
        .select()
        .from(schema.cpOrganizationClassrooms)
        .where(eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!));

      const classroomIds = orgClassrooms.map((oc) => oc.classroomId);

      if (classroomIds.length === 0) return [];

      // If specific classroom requested, verify access
      if (input.classroomId) {
        if (!classroomIds.includes(input.classroomId)) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Classroom not found or access denied',
          });
        }

        // Return machines for specific classroom
        const result = await openpathDb
          .select()
          .from(machines)
          .where(eq(machines.classroomId, input.classroomId));

        return result.map((m) => ({
          id: m.id,
          hostname: m.hostname,
          classroomId: m.classroomId,
          version: m.version,
          lastSeen: m.lastSeen?.toISOString() ?? null,
          hasDownloadToken: m.downloadTokenHash !== null,
          downloadTokenLastRotatedAt: m.downloadTokenLastRotatedAt?.toISOString() ?? null,
        }));
      }

      // Return machines for all organization's classrooms
      const result = await openpathDb
        .select()
        .from(machines)
        .where(inArray(machines.classroomId, classroomIds));

      return result.map((m) => ({
        id: m.id,
        hostname: m.hostname,
        classroomId: m.classroomId,
        version: m.version,
        lastSeen: m.lastSeen?.toISOString() ?? null,
        hasDownloadToken: m.downloadTokenHash !== null,
        downloadTokenLastRotatedAt: m.downloadTokenLastRotatedAt?.toISOString() ?? null,
      }));
    }),

  listExemptions: tenantProcedure
    .input(z.object({ classroomId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      await assertOrgClassroomAccess(ctx.organizationId!, input.classroomId);

      const now = new Date();

      const rows = await openpathDb
        .select({
          id: machineExemptions.id,
          machineId: machineExemptions.machineId,
          machineHostname: machines.hostname,
          classroomId: machineExemptions.classroomId,
          scheduleId: machineExemptions.scheduleId,
          createdBy: machineExemptions.createdBy,
          createdAt: machineExemptions.createdAt,
          expiresAt: machineExemptions.expiresAt,
        })
        .from(machineExemptions)
        .innerJoin(machines, eq(machines.id, machineExemptions.machineId))
        .where(
          and(
            eq(machineExemptions.classroomId, input.classroomId),
            gt(machineExemptions.expiresAt, now)
          )
        );

      return {
        classroomId: input.classroomId,
        exemptions: rows.map((e) => ({
          id: e.id,
          machineId: e.machineId,
          machineHostname: e.machineHostname,
          classroomId: e.classroomId,
          scheduleId: e.scheduleId,
          createdBy: e.createdBy ?? null,
          createdAt: e.createdAt ? e.createdAt.toISOString() : null,
          expiresAt: e.expiresAt.toISOString(),
        })),
      };
    }),

  createExemption: tenantProcedure
    .input(
      z.object({
        machineId: z.string().min(1),
        classroomId: z.string().min(1),
        scheduleId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      await assertOrgClassroomAccess(ctx.organizationId!, input.classroomId);

      const machineRow = await openpathDb
        .select({ id: machines.id, classroomId: machines.classroomId, hostname: machines.hostname })
        .from(machines)
        .where(eq(machines.id, input.machineId))
        .limit(1);

      const machine = machineRow[0];
      if (!machine || machine.classroomId !== input.classroomId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Machine not found' });
      }

      const now = new Date();
      const { dayOfWeek, timeHHMM } = getScheduleClock(now);
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Schedules are inactive on weekends',
        });
      }

      const scheduleRows = await openpathDb
        .select({ id: schedules.id, endTime: schedules.endTime })
        .from(schedules)
        .where(
          and(
            eq(schedules.id, input.scheduleId as any),
            eq(schedules.classroomId, input.classroomId),
            eq(schedules.dayOfWeek, dayOfWeek),
            sql`${schedules.startTime} <= ${timeHHMM}::time`,
            sql`${schedules.endTime} > ${timeHHMM}::time`
          )
        )
        .limit(1);

      const schedule = scheduleRows[0];
      if (!schedule) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Schedule is not active' });
      }

      const endHHMM = normalizeTimeHHMM(schedule.endTime);
      const nowMin = parseTimeToMinutes(timeHHMM);
      const endMin = parseTimeToMinutes(endHHMM);
      if (!Number.isFinite(nowMin) || !Number.isFinite(endMin) || endMin <= nowMin) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid schedule end time' });
      }

      const msIntoMinute = now.getSeconds() * 1000 + now.getMilliseconds();
      const expiresAt = new Date(now.getTime() - msIntoMinute + (endMin - nowMin) * 60_000);

      const id = `exempt_${nanoid(10)}`;
      const inserted = await openpathDb
        .insert(machineExemptions)
        .values({
          id,
          machineId: input.machineId,
          classroomId: input.classroomId,
          scheduleId: input.scheduleId as any,
          createdBy: ctx.user.sub,
          expiresAt,
        } as any)
        .onConflictDoNothing({
          target: [
            machineExemptions.machineId,
            machineExemptions.scheduleId,
            machineExemptions.expiresAt,
          ],
        })
        .returning();

      const created = inserted[0];
      const row =
        created ??
        (
          await openpathDb
            .select()
            .from(machineExemptions)
            .where(
              and(
                eq(machineExemptions.machineId, input.machineId),
                eq(machineExemptions.scheduleId, input.scheduleId as any),
                eq(machineExemptions.expiresAt, expiresAt)
              )
            )
            .limit(1)
        )[0];

      if (!row) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Could not create exemption' });
      }

      await notifyOpenPathClassroomChanged(input.classroomId);

      return {
        id: row.id,
        machineId: row.machineId,
        classroomId: row.classroomId,
        scheduleId: row.scheduleId,
        createdBy: row.createdBy ?? null,
        createdAt: row.createdAt ? row.createdAt.toISOString() : null,
        expiresAt: row.expiresAt.toISOString(),
      };
    }),

  deleteExemption: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      const existing = await openpathDb
        .select({ id: machineExemptions.id, classroomId: machineExemptions.classroomId })
        .from(machineExemptions)
        .where(eq(machineExemptions.id, input.id))
        .limit(1);

      const row = existing[0];
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Exemption not found' });
      }

      await assertOrgClassroomAccess(ctx.organizationId!, row.classroomId);

      await openpathDb.delete(machineExemptions).where(eq(machineExemptions.id, input.id));

      await notifyOpenPathClassroomChanged(row.classroomId);
      return { success: true };
    }),

  setActiveGroup: tenantProcedure
    .input(z.object({ id: z.string(), groupId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      const orgClassroom = await db
        .select()
        .from(schema.cpOrganizationClassrooms)
        .where(
          and(
            eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationClassrooms.classroomId, input.id)
          )
        )
        .limit(1);

      if (!orgClassroom.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Classroom not found or access denied',
        });
      }

      // Verify groupId belongs to the org (skip if null to deactivate group)
      if (input.groupId !== null) {
        await assertOrgGroupAccess(ctx.organizationId!, input.groupId);

        await assertCanUseGroup(ctx, input.groupId);
      }

      const [updated] = await openpathDb
        .update(classrooms)
        .set({ activeGroupId: input.groupId } as any)
        .where(eq(classrooms.id, input.id))
        .returning();

      const currentScheduleGroupId = await getCurrentScheduleGroupId({ classroomId: updated.id });
      const currentGroupId =
        updated.activeGroupId ?? currentScheduleGroupId ?? updated.defaultGroupId ?? null;
      const currentGroupSource = updated.activeGroupId
        ? 'manual'
        : currentScheduleGroupId
          ? 'schedule'
          : updated.defaultGroupId
            ? 'default'
            : 'none';

      await notifyOpenPathClassroomChanged(updated.id);

      // Serialize Date fields for JSON compatibility
      return {
        id: updated.id,
        name: toPublicClassroomName(updated),
        displayName: updated.displayName,
        defaultGroupId: updated.defaultGroupId,
        activeGroupId: updated.activeGroupId,
        currentGroupId,
        currentGroupSource,
        createdAt: updated.createdAt?.toISOString() ?? null,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      };
    }),

  deleteMachine: tenantProcedure
    .input(z.object({ id: z.string(), classroomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      const orgClassroom = await db
        .select()
        .from(schema.cpOrganizationClassrooms)
        .where(
          and(
            eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationClassrooms.classroomId, input.classroomId)
          )
        )
        .limit(1);

      if (!orgClassroom.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Classroom not found or access denied',
        });
      }

      await openpathDb
        .delete(machines)
        .where(and(eq(machines.id, input.id), eq(machines.classroomId, input.classroomId)));

      return { success: true };
    }),

  create: tenantProcedure.input(CreateClassroomSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);
    const publicName = input.name.trim();
    const displayName = input.displayName?.trim() || publicName;

    if (!publicName) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Classroom name is required' });
    }

    const classroomId = nanoid();
    const scopedName = scopedClassroomNameForOrg(ctx.organizationId!, publicName);

    if (input.defaultGroupId !== undefined) {
      await assertOrgGroupAccess(ctx.organizationId!, input.defaultGroupId);
      await assertCanUseGroup(ctx, input.defaultGroupId);
    }

    let classroom;
    try {
      [classroom] = await openpathDb
        .insert(classrooms)
        .values({
          id: classroomId,
          name: scopedName,
          displayName,
          defaultGroupId: input.defaultGroupId,
        })
        .returning();
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Classroom with this name already exists in your organization',
        });
      }
      throw error;
    }

    await db.insert(schema.cpOrganizationClassrooms).values({
      id: nanoid(),
      organizationId: ctx.organizationId!,
      classroomId: classroom.id,
    });

    const currentScheduleGroupId = await getCurrentScheduleGroupId({ classroomId: classroom.id });
    const currentGroupId =
      classroom.activeGroupId ?? currentScheduleGroupId ?? classroom.defaultGroupId ?? null;
    const currentGroupSource = classroom.activeGroupId
      ? 'manual'
      : currentScheduleGroupId
        ? 'schedule'
        : classroom.defaultGroupId
          ? 'default'
          : 'none';

    // Serialize Date fields for JSON compatibility
    return {
      id: classroom.id,
      name: toPublicClassroomName(classroom),
      displayName: classroom.displayName,
      defaultGroupId: classroom.defaultGroupId,
      activeGroupId: classroom.activeGroupId,
      currentGroupId,
      currentGroupSource,
      createdAt: classroom.createdAt?.toISOString() ?? null,
      updatedAt: classroom.updatedAt?.toISOString() ?? null,
    };
  }),

  update: tenantProcedure.input(UpdateClassroomSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);
    const orgClassroom = await db
      .select()
      .from(schema.cpOrganizationClassrooms)
      .where(
        and(
          eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationClassrooms.classroomId, input.id)
        )
      )
      .limit(1);

    if (!orgClassroom.length) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Classroom not found or access denied',
      });
    }

    if (input.defaultGroupId !== undefined) {
      await assertOrgGroupAccess(ctx.organizationId!, input.defaultGroupId);
      await assertCanUseGroup(ctx, input.defaultGroupId);
    }

    const { id, ...updateData } = input;
    const [updated] = await openpathDb
      .update(classrooms)
      .set(updateData)
      .where(eq(classrooms.id, id))
      .returning();

    if (input.defaultGroupId !== undefined) {
      await notifyOpenPathClassroomChanged(updated.id);
    }

    const currentScheduleGroupId = await getCurrentScheduleGroupId({ classroomId: updated.id });
    const currentGroupId =
      updated.activeGroupId ?? currentScheduleGroupId ?? updated.defaultGroupId ?? null;
    const currentGroupSource = updated.activeGroupId
      ? 'manual'
      : currentScheduleGroupId
        ? 'schedule'
        : updated.defaultGroupId
          ? 'default'
          : 'none';

    // Serialize Date fields for JSON compatibility
    return {
      id: updated.id,
      name: toPublicClassroomName(updated),
      displayName: updated.displayName,
      defaultGroupId: updated.defaultGroupId,
      activeGroupId: updated.activeGroupId,
      currentGroupId,
      currentGroupSource,
      createdAt: updated.createdAt?.toISOString() ?? null,
      updatedAt: updated.updatedAt?.toISOString() ?? null,
    };
  }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);
    const orgClassroom = await db
      .select()
      .from(schema.cpOrganizationClassrooms)
      .where(
        and(
          eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationClassrooms.classroomId, input.id)
        )
      )
      .limit(1);

    if (!orgClassroom.length) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Classroom not found or access denied',
      });
    }

    await db
      .delete(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.id, orgClassroom[0].id));

    await openpathDb.delete(classrooms).where(eq(classrooms.id, input.id));

    return { success: true };
  }),
});
