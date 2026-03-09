import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  unique,
  uuid,
  time,
} from 'drizzle-orm/pg-core';
import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: config.databaseUrl,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on OpenPath DB idle client', {
    message: err.message,
    stack: err.stack,
  });
});

export const openpathDb = drizzle(pool);

const DEFAULT_OPENPATH_DB_EVENTS_CHANNEL = 'openpath_events';

export type OpenPathDbEventPayload =
  | { type: 'group'; groupId: string; origin?: string }
  | { type: 'classroom'; classroomId: string; origin?: string }
  | { type: 'broadcast'; origin?: string };

export function resolveOpenPathDbEventsChannel(): string {
  const raw = process.env.OPENPATH_DB_EVENTS_CHANNEL ?? DEFAULT_OPENPATH_DB_EVENTS_CHANNEL;
  return /^[a-zA-Z0-9_]+$/.test(raw) ? raw : DEFAULT_OPENPATH_DB_EVENTS_CHANNEL;
}

export async function notifyOpenPathEvent(event: OpenPathDbEventPayload): Promise<void> {
  try {
    await pool.query('SELECT pg_notify($1, $2)', [
      resolveOpenPathDbEventsChannel(),
      JSON.stringify(event),
    ]);
  } catch (err) {
    // Best-effort: notifications should not break normal operations.
    logger.warn('Failed to NOTIFY OpenPath DB events channel', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function notifyOpenPathGroupChanged(groupId: string): Promise<void> {
  await notifyOpenPathEvent({ type: 'group', groupId });
}

export async function notifyOpenPathClassroomChanged(classroomId: string): Promise<void> {
  await notifyOpenPathEvent({ type: 'classroom', classroomId });
}

export async function touchWhitelistGroupUpdatedAt(groupId: string): Promise<void> {
  await openpathDb
    .update(whitelistGroups)
    .set({ updatedAt: new Date() })
    .where(eq(whitelistGroups.id, groupId));
}

export async function publishWhitelistGroupChanged(groupId: string): Promise<void> {
  await touchWhitelistGroupUpdatedAt(groupId);
  await notifyOpenPathGroupChanged(groupId);
}

export async function publishWhitelistGroupsChanged(groupIds: readonly string[]): Promise<void> {
  const unique = [...new Set(groupIds)];
  await Promise.all(unique.map((groupId) => touchWhitelistGroupUpdatedAt(groupId)));
  await Promise.all(unique.map((groupId) => notifyOpenPathGroupChanged(groupId)));
}

export async function closeOpenPathConnection() {
  await pool.end();
}

export const roles = pgTable('roles', {
  id: varchar('id', { length: 50 }).primaryKey(),
  userId: varchar('user_id', { length: 50 }).notNull(),
  role: varchar('role', { length: 20 }).notNull(),
  groupIds: text('group_ids').array(),
  createdBy: varchar('created_by', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const users = pgTable('users', {
  id: varchar('id', { length: 50 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const classrooms = pgTable('classrooms', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  defaultGroupId: varchar('default_group_id', { length: 100 }),
  activeGroupId: varchar('active_group_id', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const whitelistGroups = pgTable('whitelist_groups', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  enabled: integer('enabled').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const whitelistRules = pgTable(
  'whitelist_rules',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    groupId: varchar('group_id', { length: 50 }).notNull(),
    type: varchar('type', { length: 50 }).notNull(),
    value: varchar('value', { length: 500 }).notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    // Unique constraint for ON CONFLICT DO NOTHING
    groupTypeValueUnique: unique('whitelist_rules_group_type_value_key').on(
      table.groupId,
      table.type,
      table.value
    ),
  })
);

export const machines = pgTable('machines', {
  id: varchar('id', { length: 50 }).primaryKey(),
  hostname: varchar('hostname', { length: 255 }).unique().notNull(),
  reportedHostname: varchar('reported_hostname', { length: 255 }),
  classroomId: varchar('classroom_id', { length: 50 }).references(() => classrooms.id, {
    onDelete: 'cascade',
  }),
  version: varchar('version', { length: 50 }).default('unknown'),
  lastSeen: timestamp('last_seen', { withTimezone: true }).defaultNow(),
  downloadTokenHash: varchar('download_token_hash', { length: 64 }).unique(),
  downloadTokenLastRotatedAt: timestamp('download_token_last_rotated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  classroomId: varchar('classroom_id', { length: 50 }).notNull(),
  teacherId: varchar('teacher_id', { length: 50 }).notNull(),
  groupId: varchar('group_id', { length: 100 }).notNull(),
  dayOfWeek: integer('day_of_week'),
  startTime: time('start_time'),
  endTime: time('end_time'),
  startAt: timestamp('start_at', { withTimezone: true }),
  endAt: timestamp('end_at', { withTimezone: true }),
  recurrence: varchar('recurrence', { length: 20 }).default('weekly'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const machineExemptions = pgTable(
  'machine_exemptions',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    machineId: varchar('machine_id', { length: 50 }).notNull(),
    classroomId: varchar('classroom_id', { length: 50 }).notNull(),
    scheduleId: uuid('schedule_id').notNull(),
    createdBy: varchar('created_by', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    machineScheduleExpiresUnique: unique('machine_exemptions_machine_schedule_expires_key').on(
      table.machineId,
      table.scheduleId,
      table.expiresAt
    ),
  })
);

export const requests = pgTable('requests', {
  id: varchar('id', { length: 50 }).primaryKey(),
  domain: varchar('domain', { length: 255 }).notNull(),
  reason: text('reason'),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  requesterEmail: varchar('requester_email', { length: 255 }).notNull(),
  groupId: varchar('group_id', { length: 50 }).references(() => whitelistGroups.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: varchar('resolved_by', { length: 255 }),
  resolutionNote: text('resolution_note'),
});

export const openpathSchema = {
  roles,
  users,
  classrooms,
  machines,
  schedules,
  machineExemptions,
  whitelistGroups,
  whitelistRules,
  requests,
};
