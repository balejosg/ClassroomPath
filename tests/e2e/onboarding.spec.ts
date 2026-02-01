import { test, expect } from '@playwright/test';

test.describe('Happy Path: User Registration & Onboarding', () => {
  test('should allow a new user to register and create an organization', async ({ page }) => {
    // 1. Go to landing / register
    await page.goto('/');
    
    // Assuming the initial view is either login or register
    // Click on "Crear Cuenta" if we are on login, or just fill the form if on register
    const registerTitle = page.getByText('Crear Cuenta');
    if (!await registerTitle.isVisible()) {
        await page.getByText('¿No tienes cuenta? Regístrate').click();
    }

    // 2. Fill Registration Form
    const testEmail = `test-${Date.now()}@example.com`;
    await page.getByPlaceholder('correo@ejemplo.com').fill(testEmail);
    await page.getByPlaceholder('Tu nombre completo').fill('E2E Test User');
    await page.locator('input[type="password"]').first().fill('StrongPassword123');
    await page.locator('input[type="password"]').last().fill('StrongPassword123');
    await page.getByLabel(/Acepto los/).check();
    
    await page.getByRole('button', { name: 'Registrarse' }).click();

    // 3. Onboarding: Create Organization
    await expect(page.getByText('¡Bienvenido a ClassroomPath!')).toBeVisible({ timeout: 10000 });
    
    await page.getByPlaceholder('Ej: Colegio San José').fill('E2E Organization');
    await page.getByRole('button', { name: 'Crear Organización' }).click();

    // 4. Verification: Should land on Dashboard
    // Dashboard usually has a "Grupos" or "Equipos" text
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('E2E Organization')).toBeVisible();
  });
});
