import { beforeEach, describe, expect, it, vi } from 'vitest';

const useOnboardingStatusQuery = vi.fn();
const useListOrganizationsQuery = vi.fn();
const useCreateOrganizationMutation = vi.fn();
const useWaitForInvitationMutation = vi.fn();
const useCancelWaitingMutation = vi.fn();
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
