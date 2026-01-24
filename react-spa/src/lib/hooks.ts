import { cpTrpcReact } from './dual-trpc-provider';

export function useOnboardingStatus(options = {}) {
  return cpTrpcReact.onboarding.status.useQuery(undefined, options);
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
