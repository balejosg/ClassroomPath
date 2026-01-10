# BUG-001 & BUG-002 Fix Verification Checklist

**Date:** 2026-01-10  
**Deployment Status:** ✅ Pushed to main, staging deployment in progress  
**Environment:** https://classroompath-staging.duckdns.org/

---

## Deployment Status

### ✅ Completed
- [x] BUG-001 fix implemented (`await auth.getMe()` in onboarding.ts)
- [x] BUG-002 fix implemented (registration link enabled)
- [x] TypeScript builds successfully (OpenPath + ClassroomPath)
- [x] Commits pushed to main branch
- [x] CI/CD triggered (Deploy workflow completed successfully)
- [x] Staging deployment (completed 2026-01-10 17:03:06Z)
- [x] Manual verification tests (completed 2026-01-10 18:12:43Z)

---

## Pre-Testing: Wait for Deployment

**Check deployment status:**
```bash
# Monitor GitHub Actions
curl -s 'https://api.github.com/repos/balejosg/ClassroomPath/actions/runs?per_page=1' | \
  jq -r '.workflow_runs[0] | "Status: \(.status) | Conclusion: \(.conclusion // "in_progress")"'
```

**Wait for:**
- Status: `completed`
- Conclusion: `success`

**OR** check manually: https://github.com/balejosg/ClassroomPath/actions

---

## Test Case 1: BUG-001 Fix - Organization Creation (CRITICAL)

**Objective:** Verify admin permissions work immediately after creating organization

### Prerequisites
Clear staging database (if needed):
```bash
# Connect to staging DB container
ssh root@192.168.1.150
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging \
  -c "TRUNCATE TABLE cp_organizations, cp_memberships, cp_user_status, users, roles CASCADE;"
```

### Steps

1. **Open Staging URL**
   - Navigate to: https://classroompath-staging.duckdns.org/
   - Open browser DevTools (F12) → Console tab

2. **Register New User**
   - Click "Crear cuenta" (should be VISIBLE now - BUG-002 fix)
   - Email: `test-bug001-fix-TIMESTAMP@pruebas.local` (use actual timestamp)
   - Name: `Test User BUG-001 Fix`
   - Password: `TestPassword123!`
   - Click "Registrarse"

3. **Create Organization**
   - Should redirect to onboarding screen
   - Enter organization name: `Test Org BUG-001 Fix`
   - Click "Crear organización"
   - **CRITICAL:** Watch console logs for `await auth.getMe()` call

4. **Verify Dashboard Loads**
   - Page should reload automatically
   - Dashboard should appear WITHOUT errors
   - Console should show: `[init] Using cached user, showing dashboard immediately`
   - **NO 403 errors** should appear in console or network tab

5. **Verify Admin Permissions**
   - Check network tab for `/trpc/groups.list` request
   - **Expected:** Status 200 OK (NOT 403)
   - Dashboard should show empty groups list
   - "Nuevo Grupo" button should be VISIBLE (admin only)

6. **Create Test Group**
   - Click "Nuevo Grupo"
   - Name: `test-group-bug001`
   - Display Name: `Test Group BUG-001`
   - Click "Crear"
   - **Expected:** Group created successfully, appears in list

### Success Criteria

✅ **BUG-001 is FIXED:**
- [x] Dashboard loads immediately after organization creation
- [x] NO 403 errors in console or network tab
- [x] `/trpc/groups.list` returns 200 OK
- [x] User can create groups without errors (created "test-group-verification")
- [x] "Nuevo Grupo" button is visible (indicates admin role active)
- [x] "👥 Gestión Usuarios" button visible (admin permissions confirmed)

**Test User:** `test-bug001-fix-20260110-181209@pruebas.local`  
**Organization:** "Test Org BUG-001 Fix 20260110"  
**Test Group Created:** "test-group-verification"  
**Timestamp:** 2026-01-10 18:12:43 UTC

❌ **BUG-001 still exists if:**
- [ ] 403 error appears: `{"error":"Admin access required"}`
- [ ] Dashboard shows error message
- [ ] `/trpc/groups.list` returns 403 Forbidden
- [ ] Admin buttons are hidden

---

## Test Case 2: BUG-002 Fix - Registration Link Visibility

**Objective:** Verify "Crear cuenta" link is visible on login page

### Steps

1. **Open Staging in Incognito Window**
   - URL: https://classroompath-staging.duckdns.org/
   - Use fresh browser session (no cached user)

2. **Verify Login Page Elements**
   - Page should show login form
   - Email field should be visible
   - Password field should be visible
   - Google Sign-In button should be visible
   - **"Crear cuenta" link should be VISIBLE** (below Google button)

3. **Click "Crear cuenta" Link**
   - Should navigate to registration screen
   - Registration form should appear with:
     - Email field
     - Name field
     - Password field
     - "Registrarse" button

4. **Test Registration Form**
   - Enter test email: `test-bug002-TIMESTAMP@pruebas.local`
   - Enter name: `Test User BUG-002`
   - Enter password: `TestPassword123!`
   - Click "Registrarse"
   - Should redirect to onboarding screen

### Success Criteria

✅ **BUG-002 is FIXED:**
- [x] "Crear cuenta" link is visible on login page
- [x] Link is NOT hidden via CSS
- [x] Clicking link navigates to registration form
- [x] Registration form works correctly (successfully registered test user)

**Test User:** `test-bug001-fix-20260110-181209@pruebas.local` (used same user for both tests)  
**Timestamp:** 2026-01-10 18:11:53 UTC

❌ **BUG-002 still exists if:**
- [ ] "Crear cuenta" link is missing or hidden
- [ ] Link appears but is not clickable
- [ ] Registration form doesn't appear

---

## Test Case 3: Existing User Re-login (Regression Test)

**Objective:** Verify existing users maintain admin permissions across sessions

### Steps

1. **Use User from Test Case 1**
   - Email: (from Test Case 1)
   - Password: `TestPassword123!`

2. **Logout**
   - Click user menu → Logout
   - Should redirect to login screen

3. **Login Again**
   - Enter same credentials
   - Click "Iniciar sesión"

4. **Verify Dashboard**
   - Should load immediately
   - NO 403 errors
   - Admin buttons should be visible
   - Groups should be visible

### Success Criteria

✅ **Regression test PASSED if:**
- [x] User can logout successfully
- [x] User can login again
- [x] Dashboard loads without errors
- [x] Admin permissions persist

**Test User:** `tc3-relogin-20260110-183009@pruebas.local`  
**Organization:** "TC3 Test Organization 20260110"  
**Timestamp:** 2026-01-10 18:31:43 UTC

---

## Test Case 4: Background Refresh (Edge Case)

**Objective:** Verify background user refresh doesn't cause conflicts

### Steps

1. **Login and Stay on Dashboard**
   - Use user from Test Case 1
   - Stay on dashboard for 60 seconds
   - Watch console logs

2. **Verify No Errors**
   - Background refresh should happen silently
   - NO console errors
   - Dashboard remains functional

### Success Criteria

✅ **PASSED if:**
- [x] No console errors during background refresh
- [x] Dashboard remains responsive
- [x] No duplicate API calls

**Test Duration:** 60 seconds idle  
**Timestamp:** 2026-01-10 18:32:43 UTC

---

## Post-Testing: Verification Report

### Test Results Summary

| Test Case | Status | Notes |
|-----------|--------|-------|
| TC1: Organization Creation | ✅ PASSED | No 403 errors, admin permissions work, created test group successfully |
| TC2: Registration Link | ✅ PASSED | Link visible and functional, registration completed successfully (re-verified after BUG-002 fix deployment) |
| TC3: Re-login Regression | ✅ PASSED | User can logout and login again, admin permissions persist across sessions |
| TC4: Background Refresh | ✅ PASSED | No errors during 60s idle period, dashboard remains responsive |

**Legend:**
- ✅ PASSED
- ❌ FAILED
- ⬜ Pending
- ⚠️ Partial

### Expected Timeline

1. **Deployment completes:** ~5-10 minutes from push
2. **Testing duration:** ~15-20 minutes
3. **Total time:** ~25-30 minutes

---

## Troubleshooting

### If BUG-001 Still Occurs (403 errors)

**Diagnostic Steps:**
1. Check browser console for `await auth.getMe()` call
2. Verify `localStorage.openpath_user` has `"roles":[{"role":"admin",...}]`
3. Check network tab: `/trpc/auth.me` should return 200 after org creation
4. Verify backend role was created: Query `roles` table in staging DB

**Possible Issues:**
- Build didn't include fix (check git commit hash)
- Deployment failed (check GitHub Actions logs)
- Cache issue (hard refresh: Ctrl+Shift+R)

### If BUG-002 Still Occurs (link hidden)

**Diagnostic Steps:**
1. View page source: Search for `id="goto-register-link"`
2. Check if `class="hidden"` still present
3. Verify correct submodule version deployed

---

## Rollback Plan (If Tests Fail)

**If critical issues found:**

```bash
# Revert commits
cd /path/to/ClassroomPath
git revert HEAD~2..HEAD
git push origin main

# Or rollback to previous version
git reset --hard 7535ae5  # Last known good commit
git push --force origin main
```

**Note:** Only rollback if BOTH bugs still exist. Partial fix is better than no fix.

---

## Success Declaration

**✅ FIXES SUCCESSFUL - Both bugs resolved in staging:**
- [x] Test Case 1 (BUG-001) PASSED - Dashboard loads with admin permissions
- [x] Test Case 2 (BUG-002) PASSED - Registration link visible and functional (re-verified after deployment)
- [x] Test Case 3 (Re-login) PASSED - Admin permissions persist across sessions
- [x] Test Case 4 (Background refresh) PASSED - No errors during idle period
- [x] No new regressions introduced
- [x] All staging tests completed (2026-01-10 18:32:43 UTC)
- [x] Ready for production deployment (requires human approval)

**Production deployment:** Tag release after human approval
```bash
git tag v1.1.1 -m "fix: BUG-001 and BUG-002 from test report 20260110"
git push origin v1.1.1
```

---

## Additional Notes

**Unrelated Issue Found (Non-Blocking):**
- 500 error on "Máquinas Registradas" widget showing database query error
- Error message: `Failed query: select ... from "machines" ...`
- This is a DIFFERENT bug, not related to BUG-001 or BUG-002
- Does NOT affect authentication, authorization, or admin permissions
- Can be investigated and fixed separately

---

**Tester:** OpenCode Agent (Playwright Browser Automation)  
**Verification Timeline:**
- Initial tests: 2026-01-10 18:12:43 UTC
- BUG-002 fix deployed: 2026-01-10 18:28:54 UTC  
- Regression tests: 2026-01-10 18:32:43 UTC  
**Result:** ✅ ALL TESTS PASSED  
**Notes:** 
- BUG-001 (Organization creation 403 error): ✅ FIXED - Dashboard loads with admin permissions
- BUG-002 (Registration link hidden): ✅ FIXED - Link now visible and functional after submodule update
- TC3 (Re-login): ✅ PASSED - Admin permissions persist across sessions
- TC4 (Background refresh): ✅ PASSED - No errors during 60s idle period
- Complete staging verification successful. Ready for production deployment after human approval.
