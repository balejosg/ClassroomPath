import type { AnyRouter } from '@trpc/server';

export interface EnumeratedProcedure {
  path: string;
  type: 'query' | 'mutation';
  tenantScoped: boolean;
}

/**
 * Flatten a composed tRPC v11 router into a list of its leaf procedures with
 * their type and whether they carry the tenantScoped meta marker. tRPC v11
 * stores fully-qualified dotted paths as keys of router._def.procedures.
 */
export function enumerateProcedures(router: AnyRouter): EnumeratedProcedure[] {
  const procedures = router._def.procedures as Record<
    string,
    { _def: { type: 'query' | 'mutation'; meta?: { tenantScoped?: boolean } } }
  >;

  return Object.entries(procedures)
    .map(([path, proc]) => ({
      path,
      type: proc._def.type,
      tenantScoped: proc._def.meta?.tenantScoped === true,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Procedures that are deliberately NOT tenant-scoped: pre-auth/session auth
 * flows, per-user onboarding, health/telemetry passthrough, per-user API
 * tokens, and billing (which resolves its org through protectedProcedure +
 * assertOrganizationEntitled, not the tenantProcedure family, and touches only
 * cp_* tables — never the OpenPath mirror). Every entry here is a conscious
 * exemption from the adversarial cross-tenant harness.
 */
export const NON_TENANT_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // auth (public/protected session + registration + invitation + recovery)
  'auth.login',
  'auth.refresh',
  'auth.googleLogin',
  'auth.me',
  'auth.changePassword',
  'auth.logout',
  'auth.register',
  'auth.googleSignup',
  'auth.generateEmailVerificationToken',
  'auth.verifyEmail',
  'auth.getInvitation',
  'auth.acceptInvitation',
  'auth.acceptPendingInvitation',
  'auth.resetPassword',
  // onboarding (protectedProcedure; per-user org selection, pre-tenant)
  'onboarding.listOrganizations',
  'onboarding.status',
  'onboarding.createOrganization',
  'onboarding.waitForInvitation',
  'onboarding.cancelWaiting',
  // healthcheck (public passthrough)
  'healthcheck.live',
  'healthcheck.ready',
  'healthcheck.systemInfo',
  // apiTokens (protectedProcedure; per-user, forwarded to OpenPath)
  'apiTokens.list',
  'apiTokens.create',
  'apiTokens.revoke',
  'apiTokens.regenerate',
  // client telemetry (public ingest)
  'clientTelemetry.report',
  // billing (protectedProcedure + assertOrganizationEntitled; cp_* tables only)
  'billing.createCheckout',
  'billing.createManualRequest',
  'billing.listManualRequests',
  'billing.approveManualRequest',
  'billing.rejectManualRequest',
  'billing.listEntitlements',
  'billing.getAuditTrail',
  // push (public VAPID key fetch)
  'push.getVapidPublicKey',
]);
