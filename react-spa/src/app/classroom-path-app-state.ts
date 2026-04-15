export function isUnauthorizedOnboardingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const trpcError = error as {
    data?: { code?: string; httpStatus?: number };
    shape?: { data?: { code?: string; httpStatus?: number } };
    message?: string;
  };

  const code = trpcError.data?.code || trpcError.shape?.data?.code;
  const httpStatus = trpcError.data?.httpStatus || trpcError.shape?.data?.httpStatus;
  const message = trpcError.message?.toLowerCase() ?? '';

  return (
    code === 'UNAUTHORIZED' ||
    httpStatus === 401 ||
    message.includes('not authenticated') ||
    message.includes('unauthorized')
  );
}

export function shouldScheduleLoadingTimeout(args: {
  isAuth: boolean;
  isLoading: boolean;
}): boolean {
  return args.isAuth && args.isLoading;
}

export function shouldSyncAuthenticatedProfile(args: {
  isAuth: boolean;
  hasMembership?: boolean;
  isWaiting?: boolean;
  hasSyncedProfile: boolean;
}): boolean {
  return (
    args.isAuth && Boolean(args.hasMembership) && !Boolean(args.isWaiting) && !args.hasSyncedProfile
  );
}
