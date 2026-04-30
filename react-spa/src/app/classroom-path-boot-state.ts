import { isUnauthorizedOnboardingError } from './classroom-path-app-state';
import {
  getAuthViewFromPathname,
  isBillingCancelPath,
  isBillingSuccessPath,
} from './classroom-path-auth-routing';

export type ClassroomPathBootScreen =
  | 'preparing'
  | 'auth'
  | 'billing-success'
  | 'billing-cancel'
  | 'onboarding-gate';

export function getClassroomPathBootScreen(args: {
  openPathReady: boolean;
  isAuth: boolean;
  pathname: string;
}): ClassroomPathBootScreen {
  if (!args.openPathReady) return 'preparing';
  if (!args.isAuth) return 'auth';
  if (getAuthViewFromPathname(args.pathname) === 'accept-invitation') return 'auth';
  if (isBillingSuccessPath(args.pathname)) return 'billing-success';
  if (isBillingCancelPath(args.pathname)) return 'billing-cancel';
  return 'onboarding-gate';
}

export function shouldRedirectToLogin(args: {
  isAuth: boolean;
  shouldShowLogin: boolean;
  pathname: string;
}): boolean {
  return !args.isAuth && args.shouldShowLogin && args.pathname !== '/login';
}

export function shouldAttemptOnboardingSessionRefresh(args: {
  isAuth: boolean;
  isError: boolean;
  error: unknown;
  hasAttemptedSessionRefresh: boolean;
  isRefreshingSession: boolean;
}): boolean {
  if (!args.isAuth) return false;
  if (!args.isError || !args.error) return false;
  if (!isUnauthorizedOnboardingError(args.error)) return false;
  if (args.hasAttemptedSessionRefresh || args.isRefreshingSession) return false;

  return true;
}
