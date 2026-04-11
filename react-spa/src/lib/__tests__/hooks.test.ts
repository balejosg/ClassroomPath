import { beforeEach, describe, expect, it, vi } from 'vitest';

const useOnboardingStatusQuery = vi.fn();
const useListOrganizationsQuery = vi.fn();
const useCreateOrganizationMutation = vi.fn();
const useWaitForInvitationMutation = vi.fn();
const useCancelWaitingMutation = vi.fn();
const useRefreshSessionMutation = vi.fn();
const useCreateBillingCheckoutMutation = vi.fn();
const useCreateManualBillingRequestMutation = vi.fn();
const usePlatformManualBillingRequestsQuery = vi.fn();
const useApproveManualBillingRequestMutation = vi.fn();
const useRejectManualBillingRequestMutation = vi.fn();
const usePlatformEntitlementsQuery = vi.fn();
const useBillingAuditTrailQuery = vi.fn();
const usePendingUsersQuery = vi.fn();
const useApproveUserMutation = vi.fn();
const useRejectUserMutation = vi.fn();

vi.mock('../dual-trpc-provider', () => ({
  cpTrpcReact: {
    onboarding: {
      status: { useQuery: useOnboardingStatusQuery },
      listOrganizations: { useQuery: useListOrganizationsQuery },
      createOrganization: { useMutation: useCreateOrganizationMutation },
      waitForInvitation: { useMutation: useWaitForInvitationMutation },
      cancelWaiting: { useMutation: useCancelWaitingMutation },
    },
    auth: {
      refresh: { useMutation: useRefreshSessionMutation },
    },
    billing: {
      createCheckout: { useMutation: useCreateBillingCheckoutMutation },
      createManualRequest: { useMutation: useCreateManualBillingRequestMutation },
      listManualRequests: { useQuery: usePlatformManualBillingRequestsQuery },
      approveManualRequest: { useMutation: useApproveManualBillingRequestMutation },
      rejectManualRequest: { useMutation: useRejectManualBillingRequestMutation },
      listEntitlements: { useQuery: usePlatformEntitlementsQuery },
      getAuditTrail: { useQuery: useBillingAuditTrailQuery },
    },
    pendingUsers: {
      list: { useQuery: usePendingUsersQuery },
      approve: { useMutation: useApproveUserMutation },
      reject: { useMutation: useRejectUserMutation },
    },
  },
}));

describe('hook wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards onboarding queries and mutations to the tRPC client', async () => {
    const hooks = await import('../hooks');
    const statusOptions = { enabled: true };
    const listOptions = { staleTime: 60_000 };

    hooks.useOnboardingStatus(statusOptions);
    hooks.useListOrganizations(listOptions);
    hooks.useCreateOrganization();
    hooks.useWaitForInvitation();
    hooks.useCancelWaiting();

    expect(useOnboardingStatusQuery).toHaveBeenCalledWith(undefined, statusOptions);
    expect(useListOrganizationsQuery).toHaveBeenCalledWith(undefined, listOptions);
    expect(useCreateOrganizationMutation).toHaveBeenCalledTimes(1);
    expect(useWaitForInvitationMutation).toHaveBeenCalledTimes(1);
    expect(useCancelWaitingMutation).toHaveBeenCalledTimes(1);
  });

  it('forwards auth and billing hooks to the tRPC client', async () => {
    const hooks = await import('../hooks');
    const manualRequestOptions = { enabled: true, staleTime: 30_000 };
    const entitlementsOptions = { refetchInterval: 30_000 };
    const auditInput = { organizationId: 'org_123' };
    const auditOptions = { enabled: true };

    hooks.useRefreshSession();
    hooks.useCreateBillingCheckout();
    hooks.useCreateManualBillingRequest();
    hooks.usePlatformManualBillingRequests(manualRequestOptions);
    hooks.useApproveManualBillingRequest();
    hooks.useRejectManualBillingRequest();
    hooks.usePlatformEntitlements(entitlementsOptions);
    hooks.useBillingAuditTrail(auditInput, auditOptions);

    expect(useRefreshSessionMutation).toHaveBeenCalledTimes(1);
    expect(useCreateBillingCheckoutMutation).toHaveBeenCalledTimes(1);
    expect(useCreateManualBillingRequestMutation).toHaveBeenCalledTimes(1);
    expect(usePlatformManualBillingRequestsQuery).toHaveBeenCalledWith(
      undefined,
      manualRequestOptions
    );
    expect(useApproveManualBillingRequestMutation).toHaveBeenCalledTimes(1);
    expect(useRejectManualBillingRequestMutation).toHaveBeenCalledTimes(1);
    expect(usePlatformEntitlementsQuery).toHaveBeenCalledWith(undefined, entitlementsOptions);
    expect(useBillingAuditTrailQuery).toHaveBeenCalledWith(auditInput, auditOptions);
  });

  it('forwards pending user hooks to the tRPC client', async () => {
    const hooks = await import('../hooks');
    const pendingOptions = { enabled: true };

    hooks.usePendingUsers(pendingOptions);
    hooks.useApproveUser();
    hooks.useRejectUser();

    expect(usePendingUsersQuery).toHaveBeenCalledWith(undefined, pendingOptions);
    expect(useApproveUserMutation).toHaveBeenCalledTimes(1);
    expect(useRejectUserMutation).toHaveBeenCalledTimes(1);
  });
});
