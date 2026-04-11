import { cpTrpcReact } from './dual-trpc-provider';

export function useOnboardingStatus(options = {}) {
  return cpTrpcReact.onboarding.status.useQuery(undefined, options);
}

export function useListOrganizations(options = {}) {
  return cpTrpcReact.onboarding.listOrganizations.useQuery(undefined, options);
}

export function useCreateOrganization() {
  return cpTrpcReact.onboarding.createOrganization.useMutation();
}

export function useWaitForInvitation() {
  return cpTrpcReact.onboarding.waitForInvitation.useMutation();
}

export function useCancelWaiting() {
  return cpTrpcReact.onboarding.cancelWaiting.useMutation();
}

export function useCreateBillingCheckout() {
  return cpTrpcReact.billing.createCheckout.useMutation();
}

export function useCreateManualBillingRequest() {
  return cpTrpcReact.billing.createManualRequest.useMutation();
}

export function usePlatformManualBillingRequests(options = {}) {
  return cpTrpcReact.billing.listManualRequests.useQuery(undefined, options);
}

export function useApproveManualBillingRequest() {
  return cpTrpcReact.billing.approveManualRequest.useMutation();
}

// Pending users hooks (admin only)
export function usePendingUsers(options = {}) {
  return cpTrpcReact.pendingUsers.list.useQuery(undefined, options);
}

export function useApproveUser() {
  return cpTrpcReact.pendingUsers.approve.useMutation();
}

export function useRejectUser() {
  return cpTrpcReact.pendingUsers.reject.useMutation();
}
