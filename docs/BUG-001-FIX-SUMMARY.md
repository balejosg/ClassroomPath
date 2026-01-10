# BUG-001 Fix Summary

**Date:** 2026-01-10  
**Fixed by:** Sisyphus AI  
**Issue:** User gets 403 "Admin access required" after creating organization  
**Reproducibility:** 100% (2/2 test runs)  
**Severity:** 🔴 BLOQUEANTE

---

## Root Cause

After organization creation, the backend correctly:
1. ✅ Creates `cp_memberships` record with `role: 'admin'`
2. ✅ Updates OpenPath `roles` table with `role: 'admin'`
3. ✅ Returns new JWT tokens with embedded admin role

**BUT** the SPA had a caching bug:
1. ✅ Stored new tokens in `localStorage`
2. ❌ Did NOT update cached user object in `localStorage.openpath_user`
3. ❌ On page reload, `init()` used stale cached user with NO roles
4. ❌ Dashboard tried to load with empty roles → 403 on `/trpc/groups.list`

---

## The Fix

**File:** `/ClassroomPath/spa/src/onboarding.ts`  
**Line:** 49 (after `auth.storeTokens()`)  
**Change:** Added `await auth.getMe()` to fetch and cache updated user

### Before
```typescript
if (result.accessToken) {
    auth.storeTokens({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: '24h',
        tokenType: 'Bearer'
    });
}
```

### After
```typescript
if (result.accessToken) {
    auth.storeTokens({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: '24h',
        tokenType: 'Bearer'
    });
    
    // CRITICAL FIX (BUG-001): Fetch and cache updated user with new admin role
    await auth.getMe();
}
```

---

## Why This Works

1. `auth.storeTokens()` → Updates tokens in `localStorage` ✅
2. `auth.getMe()` → Calls `/trpc/auth.me` with NEW token ✅
3. Backend → Returns user with updated roles (including 'admin') ✅
4. `auth.getMe()` → Stores updated user via `auth.storeUser()` ✅
5. `window.location.reload()` → Uses cached user WITH admin role ✅
6. Dashboard → Loads successfully without 403 ✅

---

## Files Changed

| File | Changes | Lines |
|------|---------|-------|
| `/ClassroomPath/spa/src/onboarding.ts` | Added `await auth.getMe()` call | +6 lines |
| `/ClassroomPath/docs/test-report-20260110-172810-SECOND-RUN.md` | Documented root cause and fix | +150 lines |

---

## Testing Verification

### ✅ Build Status
- TypeScript compilation: **PASSED**
- Vite build: **PASSED** (565ms)
- No type errors

### Manual Testing Required

**Environment:** https://classroompath-staging.duckdns.org/

#### Test Case 1: Fresh Organization Creation
1. Clear staging database (reset test environment)
2. Register new user: `test-bug001-fix@pruebas.local`
3. Create organization: "Test Org BUG-001 Fix"
4. **Expected:** Dashboard loads without errors
5. **Expected:** `/trpc/groups.list` returns 200 OK
6. **Expected:** User can create groups and rules

#### Test Case 2: Existing User Re-login
1. Logout from test account
2. Login again with same credentials
3. **Expected:** Dashboard loads immediately with admin permissions
4. **Expected:** No 403 errors in console

#### Test Case 3: Background Refresh
1. Login and wait 30 seconds on dashboard
2. **Expected:** No console errors during background refresh
3. **Expected:** Dashboard remains functional

---

## Deployment Checklist

### Staging Deployment
- [ ] Merge fix to `main` branch
- [ ] CI/CD auto-deploys to staging
- [ ] Run Manual Test Cases 1-3
- [ ] Verify no regressions in existing functionality

### Production Deployment
- [ ] Tag release (e.g., `v1.1.1`)
- [ ] CI/CD auto-deploys to production
- [ ] Monitor error logs for 24 hours
- [ ] Verify new user onboarding works

---

## Related Issues

- **BUG-002:** Registration link not visible (investigation pending)
- **Enhancement:** Add logging when cached user/token mismatch detected

---

## Technical Notes

### Why `auth.getMe()` is Required

The `storeTokens()` method only updates tokens, not the cached user object. Without calling `getMe()`:

```
localStorage.openpath_access_token = "NEW_TOKEN_WITH_ADMIN_ROLE" ✅
localStorage.openpath_user = '{"roles":[]}' ← STALE, NO ADMIN ROLE ❌
```

When the page reloads, `app-core.ts:init()` does:
```typescript
const cachedUser = auth.getUser();  // Returns stale user from localStorage
if (cachedUser) {
    showDashboardWithUser(cachedUser);  // Uses stale roles → 403
}
```

By calling `auth.getMe()` immediately after `storeTokens()`, we ensure:
```
localStorage.openpath_user = '{"roles":[{"role":"admin","groupIds":[]}]}' ✅
```

### Alternative Solutions Considered

1. **Decode JWT client-side** → Rejected (requires jwt-decode library, violates SPA's no-dependencies goal)
2. **Force re-login** → Rejected (bad UX, unnecessary)
3. **Clear cached user** → Rejected (causes dashboard to fetch user anyway, same result but worse UX)
4. **Background refresh only** → Rejected (race condition: dashboard loads before refresh completes)

**Chosen solution:** Immediate `auth.getMe()` call is the simplest, safest, and most correct fix.

---

## Success Criteria

✅ **Fix is successful when:**
1. New users can create organization and immediately access dashboard
2. No 403 errors on `/trpc/groups.list` for organization creators
3. Admin permissions work on first page load (no need to logout/login)
4. No regressions in existing login/onboarding flows
5. Background refresh continues to work without conflicts

---

**Status:** ✅ Fix Implemented, Awaiting Deployment Testing
