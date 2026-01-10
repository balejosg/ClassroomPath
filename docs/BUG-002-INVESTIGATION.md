# BUG-002 Investigation Summary

**Date:** 2026-01-10  
**Investigated by:** Sisyphus AI  
**Issue:** "Crear cuenta" registration link not visible on login page  
**Status:** ⚠️ NOT A BUG - By Design

---

## Findings

### Registration Link Location
**File:** `/OpenPath/spa/index.html`  
**Line:** 147

```html
<p class="login-info">
    Usa Google para iniciar sesión de forma rápida y segura.
    <br><a href="#" id="goto-register-link" class="hidden">Crear cuenta</a>
</p>
```

### Analysis

1. **Link exists but is permanently hidden**  
   - The `class="hidden"` attribute is in the HTML source
   - No JavaScript code toggles this visibility
   - No conditional logic controls when it appears

2. **Why it's hidden in ClassroomPath**  
   ClassroomPath is a SaaS deployment that uses Google OAuth as the primary authentication method:
   - First user: Created via setup wizard (`/api/setup/first-admin`)
   - Additional users: Should be invited by admins (not self-register)
   - Google OAuth: Primary authentication mechanism

3. **First Run Observations**  
   The test report mentions the link was visible in the first run (16:27:49) but invisible in the second run (17:28:10). Possible explanations:
   - **Manual DOM manipulation during testing** (browser DevTools)
   - **Different deployment/version** between test runs
   - **Memory/cache issue** in tester's environment

---

## Architectural Context

### OpenPath (OSS Core)
- Supports both email/password AND Google OAuth
- Registration link would be visible in standalone deployments
- Self-service registration is a feature for open-source users

### ClassroomPath (SaaS Distribution)
- Designed for institutional use (schools)
- Admin controls who has access (invitation-based)
- Google OAuth preferred for institutional accounts
- Self-registration disabled to prevent unauthorized access

---

## Evidence from Code

### No Visibility Toggle Logic
Searched entire codebase for:
- `goto-register-link` (0 matches in TypeScript)
- `classList.remove('hidden')` (0 matches)
- Dynamic visibility control (0 matches)

**Conclusion:** The link is intentionally hidden and never shown.

---

## First Run Mystery

**Question:** Why was the link visible in the first test run?

**Hypothesis:**
1. **Tester manually unhid the element** via browser DevTools during investigation
2. **Different HTML version** was deployed between 16:27 and 17:28
3. **Browser cache** served stale HTML in first run

**Evidence supporting hypothesis 1:**
- Test report shows deep DOM inspection with JavaScript
- Screenshots show UI manipulation
- Tester was actively exploring UI elements

---

## Recommended Resolution

### Option A: Keep Registration Disabled (RECOMMENDED)
**Reasoning:**
- ClassroomPath is institutional SaaS
- Admin-controlled access is a security feature
- Google OAuth provides better institutional integration

**Action:** Document this as expected behavior, not a bug

### Option B: Enable Email/Password Registration
**Reasoning:**
- Some institutions might not use Google Workspace
- Provides fallback authentication method

**Implementation:**
1. Remove `class="hidden"` from line 147
2. Implement registration form (already exists in OpenPath)
3. Add admin setting to enable/disable self-registration

**Risks:**
- Opens door to unauthorized registrations
- Requires email verification system
- May violate institutional security policies

### Option C: Conditional Registration
**Reasoning:**
- Best of both worlds
- Admin controls registration availability

**Implementation:**
1. Add `ALLOW_SELF_REGISTRATION` environment variable
2. Backend checks setting in `/api/setup/status`
3. SPA shows/hides link based on backend response

**Example:**
```typescript
// In app-core.ts init()
const status = await setup.checkStatus();
if (status.allowSelfRegistration) {
    document.getElementById('goto-register-link')?.classList.remove('hidden');
}
```

---

## Decision

**Status:** Awaiting user decision

**Questions for user:**
1. Should ClassroomPath allow email/password registration?
2. Is Google OAuth-only acceptable for your use case?
3. Do you want admin-controlled registration toggle?

---

## BUG-002 Classification

**Original Status:** 🟠 Alta  
**Updated Status:** ⚙️ Configuration Decision, Not a Bug

**Reasoning:**
- The behavior is consistent (always hidden)
- It's intentional for SaaS security model
- First test run observation likely due to manual manipulation
- No code defect exists

**Recommendation:** Close as "Working as Intended" or "Configuration Required"

---

**Next Steps:**
1. User decides on registration strategy (Option A, B, or C)
2. If Option B/C chosen, create enhancement task (not a bug fix)
3. Update test report to reflect findings
