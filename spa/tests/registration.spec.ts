import { test, expect } from '@playwright/test';

test.describe('Registration Form', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        const registerLink = page.locator('#goto-register-link');
        await registerLink.click();
        await expect(page.locator('#register-screen')).toBeVisible();
    });

    test('Registration link should be present and navigates to register screen', async ({ page }) => {
        await expect(page.locator('#email-register-form')).toBeVisible();
    });

    test('Submit button is disabled when form is empty', async ({ page }) => {
        const submitBtn = page.locator('#email-register-btn');
        await expect(submitBtn).toBeDisabled();
    });

    test('Email validation shows error for invalid email', async ({ page }) => {
        const emailInput = page.locator('#register-email');
        await emailInput.fill('invalid-email');
        await emailInput.blur();
        
        const errorEl = page.locator('#register-email-error');
        await expect(errorEl).toContainText('email válido');
    });

    test('Name validation shows error for short name', async ({ page }) => {
        const nameInput = page.locator('#register-name');
        await nameInput.fill('A');
        await nameInput.blur();
        
        const errorEl = page.locator('#register-name-error');
        await expect(errorEl).toContainText('al menos 2 caracteres');
    });

    test('Password validation shows error for weak password', async ({ page }) => {
        const passwordInput = page.locator('#register-password');
        await passwordInput.fill('short');
        
        const errorEl = page.locator('#register-password-error');
        await expect(errorEl).toContainText('8 caracteres');
    });

    test('Password validation shows error for password without uppercase', async ({ page }) => {
        const passwordInput = page.locator('#register-password');
        await passwordInput.fill('password123');
        
        const errorEl = page.locator('#register-password-error');
        await expect(errorEl).toContainText('mayúscula');
    });

    test('Password confirmation shows error when passwords do not match', async ({ page }) => {
        const passwordInput = page.locator('#register-password');
        const confirmInput = page.locator('#register-password-confirm');
        
        await passwordInput.fill('Password123');
        await confirmInput.fill('DifferentPassword123');
        
        const errorEl = page.locator('#register-password-confirm-error');
        await expect(errorEl).toContainText('no coinciden');
    });

    test('Password strength indicator shows weak for short password', async ({ page }) => {
        const passwordInput = page.locator('#register-password');
        await passwordInput.fill('abc');
        
        const strengthBar = page.locator('#password-strength-bar');
        await expect(strengthBar).toHaveClass(/weak/);
    });

    test('Password strength indicator shows strong for complete password', async ({ page }) => {
        const passwordInput = page.locator('#register-password');
        await passwordInput.fill('Password123');
        
        const strengthBar = page.locator('#password-strength-bar');
        await expect(strengthBar).toHaveClass(/strong/);
    });

    test('Password requirements update as user types', async ({ page }) => {
        const passwordInput = page.locator('#register-password');
        
        await passwordInput.fill('a');
        await expect(page.locator('#req-lower')).toHaveClass(/met/);
        await expect(page.locator('#req-upper')).toHaveClass(/unmet/);
        
        await passwordInput.fill('aA');
        await expect(page.locator('#req-upper')).toHaveClass(/met/);
        
        await passwordInput.fill('aA1');
        await expect(page.locator('#req-number')).toHaveClass(/met/);
        
        await passwordInput.fill('aA1bcdef');
        await expect(page.locator('#req-length')).toHaveClass(/met/);
    });

    test('Password toggle shows/hides password', async ({ page }) => {
        const passwordInput = page.locator('#register-password');
        const toggleBtn = page.locator('#toggle-register-password');
        
        await passwordInput.fill('Password123');
        await expect(passwordInput).toHaveAttribute('type', 'password');
        
        await toggleBtn.click();
        await expect(passwordInput).toHaveAttribute('type', 'text');
        
        await toggleBtn.click();
        await expect(passwordInput).toHaveAttribute('type', 'password');
    });

    test('Terms checkbox is required for form submission', async ({ page }) => {
        const emailInput = page.locator('#register-email');
        const nameInput = page.locator('#register-name');
        const passwordInput = page.locator('#register-password');
        const confirmInput = page.locator('#register-password-confirm');
        const submitBtn = page.locator('#email-register-btn');
        
        await emailInput.fill('test@example.com');
        await nameInput.fill('Test User');
        await passwordInput.fill('Password123');
        await confirmInput.fill('Password123');
        
        await expect(submitBtn).toBeDisabled();
        
        const termsCheckbox = page.locator('#register-terms');
        await termsCheckbox.check();
        
        await expect(submitBtn).toBeEnabled();
    });

    test('Submit button enables when all fields are valid', async ({ page }) => {
        const emailInput = page.locator('#register-email');
        const nameInput = page.locator('#register-name');
        const passwordInput = page.locator('#register-password');
        const confirmInput = page.locator('#register-password-confirm');
        const termsCheckbox = page.locator('#register-terms');
        const submitBtn = page.locator('#email-register-btn');
        
        await emailInput.fill('test@example.com');
        await nameInput.fill('Test User');
        await passwordInput.fill('Password123');
        await confirmInput.fill('Password123');
        await termsCheckbox.check();
        
        await expect(submitBtn).toBeEnabled();
    });

    test('Go to login link navigates back to login screen', async ({ page }) => {
        const loginLink = page.locator('#goto-login-link');
        await loginLink.click();
        
        await expect(page.locator('#login-screen')).toBeVisible();
        await expect(page.locator('#register-screen')).toBeHidden();
    });

    test('Form has proper ARIA attributes for accessibility', async ({ page }) => {
        const emailInput = page.locator('#register-email');
        await expect(emailInput).toHaveAttribute('aria-describedby', /register-email-error/);
        
        const passwordInput = page.locator('#register-password');
        await expect(passwordInput).toHaveAttribute('aria-describedby', /password-requirements/);
        
        const errorEl = page.locator('#register-email-error');
        await expect(errorEl).toHaveAttribute('role', 'alert');
    });
});
