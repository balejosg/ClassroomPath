import { describe, expect, it } from 'vitest';

import {
  getClassroomPathBootScreen,
  shouldAttemptOnboardingSessionRefresh,
  shouldRedirectToLogin,
} from '../classroom-path-boot-state';

describe('classroom-path-boot-state', () => {
  it('keeps OpenPath setup ahead of all app screens', () => {
    expect(
      getClassroomPathBootScreen({
        openPathReady: false,
        isAuth: true,
        pathname: '/billing/success',
      })
    ).toBe('preparing');
  });

  it('keeps logged-out users in the auth screen before billing or shell routing', () => {
    expect(
      getClassroomPathBootScreen({
        openPathReady: true,
        isAuth: false,
        pathname: '/billing/success',
      })
    ).toBe('auth');
  });

  it('routes authenticated billing returns before the onboarding gate', () => {
    expect(
      getClassroomPathBootScreen({
        openPathReady: true,
        isAuth: true,
        pathname: '/billing/success',
      })
    ).toBe('billing-success');
    expect(
      getClassroomPathBootScreen({
        openPathReady: true,
        isAuth: true,
        pathname: '/billing/cancel',
      })
    ).toBe('billing-cancel');
    expect(
      getClassroomPathBootScreen({
        openPathReady: true,
        isAuth: true,
        pathname: '/dominios',
      })
    ).toBe('onboarding-gate');
  });

  it('recognizes only unauthenticated protected paths as login redirects', () => {
    expect(
      shouldRedirectToLogin({
        isAuth: false,
        shouldShowLogin: true,
        pathname: '/dominios/aprobar/req_1',
      })
    ).toBe(true);
    expect(
      shouldRedirectToLogin({
        isAuth: false,
        shouldShowLogin: true,
        pathname: '/login',
      })
    ).toBe(false);
    expect(
      shouldRedirectToLogin({
        isAuth: true,
        shouldShowLogin: true,
        pathname: '/dominios',
      })
    ).toBe(false);
  });

  it('attempts onboarding refresh once for authenticated unauthorized status errors', () => {
    expect(
      shouldAttemptOnboardingSessionRefresh({
        isAuth: true,
        isError: true,
        error: { data: { code: 'UNAUTHORIZED', httpStatus: 401 }, message: 'Unauthorized' },
        hasAttemptedSessionRefresh: false,
        isRefreshingSession: false,
      })
    ).toBe(true);
    expect(
      shouldAttemptOnboardingSessionRefresh({
        isAuth: true,
        isError: true,
        error: { data: { code: 'UNAUTHORIZED', httpStatus: 401 }, message: 'Unauthorized' },
        hasAttemptedSessionRefresh: true,
        isRefreshingSession: false,
      })
    ).toBe(false);
    expect(
      shouldAttemptOnboardingSessionRefresh({
        isAuth: true,
        isError: true,
        error: { message: 'Boom' },
        hasAttemptedSessionRefresh: false,
        isRefreshingSession: false,
      })
    ).toBe(false);
  });
});
