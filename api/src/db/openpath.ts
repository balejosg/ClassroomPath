import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, varchar, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

const pool = new Pool({
    connectionString: config.databaseUrl,
});

export const openpathDb = drizzle(pool);

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

export const whitelistRules = pgTable('whitelist_rules', {
    id: varchar('id', { length: 50 }).primaryKey(),
    groupId: varchar('group_id', { length: 50 }).notNull(),
    type: varchar('type', { length: 50 }).notNull(),
    value: varchar('value', { length: 500 }).notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const machines = pgTable('machines', {
    id: varchar('id', { length: 50 }).primaryKey(),
    hostname: varchar('hostname', { length: 255 }).unique().notNull(),
    classroomId: varchar('classroom_id', { length: 50 }).references(
        () => classrooms.id,
        { onDelete: 'cascade' }
    ),
    version: varchar('version', { length: 50 }).default('unknown'),
    lastSeen: timestamp('last_seen', { withTimezone: true }).defaultNow(),
    downloadTokenHash: varchar('download_token_hash', { length: 64 }).unique(),
    downloadTokenLastRotatedAt: timestamp('download_token_last_rotated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const requests = pgTable('requests', {
    id: varchar('id', { length: 50 }).primaryKey(),
    domain: varchar('domain', { length: 255 }).notNull(),
    reason: text('reason'),
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    priority: varchar('priority', { length: 20 }).default('normal').notNull(),
    requesterEmail: varchar('requester_email', { length: 255 }).notNull(),
    groupId: varchar('group_id', { length: 50 }).references(() => whitelistGroups.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const openpathSchema = {
    roles,
    users,
    classrooms,
    machines,
    whitelistGroups,
    whitelistRules,
    requests,
};
