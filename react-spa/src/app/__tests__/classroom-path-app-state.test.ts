import { describe, expect, it } from 'vitest';

import {
  isUnauthorizedOnboardingError,
  shouldScheduleLoadingTimeout,
  shouldSyncAuthenticatedProfile,
} from '../classroom-path-app-state';

describe('classroom-path-app-state', () => {
  it('detects unauthorized onboarding errors from code, status, and message', () => {
    expect(
      isUnauthorizedOnboardingError({ data: { code: 'UNAUTHORIZED' }, message: 'ignored' })
    ).toBe(true);
    expect(
      isUnauthorizedOnboardingError({ shape: { data: { httpStatus: 401 } }, message: 'ignored' })
    ).toBe(true);
    expect(isUnauthorizedOnboardingError({ message: 'User is not authenticated' })).toBe(true);
    expect(isUnauthorizedOnboardingError({ message: 'Boom' })).toBe(false);
  });

  it('only schedules the loading timeout for authenticated loading states', () => {
    expect(shouldScheduleLoadingTimeout({ isAuth: true, isLoading: true })).toBe(true);
    expect(shouldScheduleLoadingTimeout({ isAuth: true, isLoading: false })).toBe(false);
    expect(shouldScheduleLoadingTimeout({ isAuth: false, isLoading: true })).toBe(false);
  });

  it('only syncs the authenticated profile once membership is ready', () => {
    expect(
      shouldSyncAuthenticatedProfile({
        isAuth: true,
        hasMembership: true,
        isWaiting: false,
        hasSyncedProfile: false,
      })
    ).toBe(true);
    expect(
      shouldSyncAuthenticatedProfile({
        isAuth: true,
        hasMembership: false,
        isWaiting: false,
        hasSyncedProfile: false,
      })
    ).toBe(false);
    expect(
      shouldSyncAuthenticatedProfile({
        isAuth: true,
        hasMembership: true,
        isWaiting: true,
        hasSyncedProfile: false,
      })
    ).toBe(false);
    expect(
      shouldSyncAuthenticatedProfile({
        isAuth: true,
        hasMembership: true,
        isWaiting: false,
        hasSyncedProfile: true,
      })
    ).toBe(false);
  });
});
