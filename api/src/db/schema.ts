import {
    pgTable,
    varchar,
    timestamp,
    unique,
} from 'drizzle-orm/pg-core';

// =============================================================================
// Organizations Table
// =============================================================================

export const cpOrganizations = pgTable('cp_organizations', {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    createdBy: varchar('created_by', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// =============================================================================
// Memberships Table
// =============================================================================

export const cpMemberships = pgTable('cp_memberships', {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 }).notNull(),
    organizationId: varchar('organization_id', { length: 50 })
        .notNull()
        .references(() => cpOrganizations.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull(), // 'admin' | 'teacher' | 'student'
    invitedBy: varchar('invited_by', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
    unique('cp_memberships_user_org_key').on(table.userId, table.organizationId),
]);

// =============================================================================
// User Onboarding Status (tracks users who chose "wait for invitation")
// =============================================================================

export const cpUserStatus = pgTable('cp_user_status', {
    userId: varchar('user_id', { length: 50 }).primaryKey(),
    status: varchar('status', { length: 20 }).notNull(), // 'waiting' | 'active'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// =============================================================================
// Type Inference
// =============================================================================

export type Organization = typeof cpOrganizations.$inferSelect;
export type NewOrganization = typeof cpOrganizations.$inferInsert;

export type Membership = typeof cpMemberships.$inferSelect;
export type NewMembership = typeof cpMemberships.$inferInsert;

export type UserStatus = typeof cpUserStatus.$inferSelect;
export type NewUserStatus = typeof cpUserStatus.$inferInsert;
