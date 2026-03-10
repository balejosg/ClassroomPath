import { pgTable, varchar, timestamp, unique, text } from 'drizzle-orm/pg-core';

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

export const cpMemberships = pgTable(
  'cp_memberships',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 }).notNull(),
    organizationId: varchar('organization_id', { length: 50 })
      .notNull()
      .references(() => cpOrganizations.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull(), // 'admin' | 'teacher' | 'student'
    invitedBy: varchar('invited_by', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique('cp_memberships_user_id_key').on(table.userId),
    unique('cp_memberships_user_org_key').on(table.userId, table.organizationId),
  ]
);

// =============================================================================
// User Onboarding Status (tracks users who chose "wait for invitation")
// =============================================================================

export const cpUserStatus = pgTable('cp_user_status', {
  userId: varchar('user_id', { length: 50 }).primaryKey(),
  status: varchar('status', { length: 20 }).notNull(), // 'waiting' | 'active'
  targetOrganizationId: varchar('target_organization_id', { length: 50 }).references(
    () => cpOrganizations.id,
    { onDelete: 'set null' }
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const cpTermsAcceptance = pgTable('cp_terms_acceptance', {
  userId: varchar('user_id', { length: 50 }).primaryKey(),
  termsVersion: varchar('terms_version', { length: 50 }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull(),
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

export type TermsAcceptance = typeof cpTermsAcceptance.$inferSelect;
export type NewTermsAcceptance = typeof cpTermsAcceptance.$inferInsert;

// =============================================================================
// Invitations Table
// =============================================================================

export const cpInvitations = pgTable(
  'cp_invitations',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 50 })
      .notNull()
      .references(() => cpOrganizations.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    role: varchar('role', { length: 20 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    invitedBy: varchar('invited_by', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('cp_invitations_token_hash_key').on(table.tokenHash),
    unique('cp_invitations_org_email_key').on(table.organizationId, table.email),
  ]
);

export type Invitation = typeof cpInvitations.$inferSelect;
export type NewInvitation = typeof cpInvitations.$inferInsert;

// =============================================================================
// Organization-Resource Relation Tables (Multi-tenancy)
// =============================================================================

// Vincular aulas con organizaciones
export const cpOrganizationClassrooms = pgTable(
  'cp_organization_classrooms',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 50 })
      .notNull()
      .references(() => cpOrganizations.id, { onDelete: 'cascade' }),
    classroomId: varchar('classroom_id', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [unique('cp_org_classroom_key').on(table.organizationId, table.classroomId)]
);

// Vincular grupos de whitelist con organizaciones
export const cpOrganizationGroups = pgTable(
  'cp_organization_groups',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 50 })
      .notNull()
      .references(() => cpOrganizations.id, { onDelete: 'cascade' }),
    groupId: varchar('group_id', { length: 50 }).notNull(),
    // Human-facing slug within the organization. Legacy rows may be null and
    // should fall back to the underlying OpenPath name until backfilled.
    publicName: varchar('public_name', { length: 100 }),
    // Visibility within the organization (aligned with OpenPath values).
    visibility: varchar('visibility', { length: 20 }).default('private').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique('cp_org_group_key').on(table.organizationId, table.groupId),
    unique('cp_org_group_public_name_key').on(table.organizationId, table.publicName),
  ]
);

// Legacy mapping retained for backwards compatibility. Tenant scoping authority lives in cp_memberships.
export const cpOrganizationUsers = pgTable(
  'cp_organization_users',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 50 })
      .notNull()
      .references(() => cpOrganizations.id, { onDelete: 'cascade' }),
    openpathUserId: varchar('openpath_user_id', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [unique('cp_org_user_key').on(table.organizationId, table.openpathUserId)]
);

export type OrganizationClassroom = typeof cpOrganizationClassrooms.$inferSelect;
export type NewOrganizationClassroom = typeof cpOrganizationClassrooms.$inferInsert;

export type OrganizationGroup = typeof cpOrganizationGroups.$inferSelect;
export type NewOrganizationGroup = typeof cpOrganizationGroups.$inferInsert;

export type OrganizationUser = typeof cpOrganizationUsers.$inferSelect;
export type NewOrganizationUser = typeof cpOrganizationUsers.$inferInsert;

// =============================================================================
// SaaS Templates (copy-on-import)
// =============================================================================

export const cpGroupTemplates = pgTable(
  'cp_group_templates',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text('description'),
    createdBy: varchar('created_by', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [unique('cp_group_templates_name_key').on(table.name)]
);

export const cpGroupTemplateRules = pgTable(
  'cp_group_template_rules',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    templateId: varchar('template_id', { length: 50 })
      .notNull()
      .references(() => cpGroupTemplates.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    value: varchar('value', { length: 500 }).notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique('cp_group_template_rules_template_type_value_key').on(
      table.templateId,
      table.type,
      table.value
    ),
  ]
);

export type GroupTemplate = typeof cpGroupTemplates.$inferSelect;
export type NewGroupTemplate = typeof cpGroupTemplates.$inferInsert;

export type GroupTemplateRule = typeof cpGroupTemplateRules.$inferSelect;
export type NewGroupTemplateRule = typeof cpGroupTemplateRules.$inferInsert;
