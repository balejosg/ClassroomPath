import { auth } from '../../upstream/openpath/spa/src/auth.js';
import { onboarding } from './onboarding.js';

import { init as openpathInit, updateEditUI } from '../../upstream/openpath/spa/src/modules/app-core.js';
import { googleAuth } from '../../upstream/openpath/spa/src/google-auth.js';
import { showToast } from '../../upstream/openpath/spa/src/utils.js';

export { updateEditUI };

let cpInitialized = false;
let isSubmitting = false; // Rate limiting: prevent double submit

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

// Error translations for server messages
const ERROR_TRANSLATIONS: Record<string, string> = {
    'Email already registered': 'Este email ya está registrado',
    'Invalid credentials': 'Credenciales inválidas',
    'User not found': 'Usuario no encontrado',
    'Invalid password': 'Contraseña incorrecta',
    'Account inactive': 'Cuenta inactiva',
    'Invalid email': 'Email inválido',
    'Password too short': 'Contraseña demasiado corta',
    'Network Error': 'Error de conexión. Comprueba tu conexión a internet.',
};

function translateError(error: string): string {
    // Check for exact matches first
    if (ERROR_TRANSLATIONS[error]) {
        return ERROR_TRANSLATIONS[error];
    }
    // Check for partial matches
    for (const [key, value] of Object.entries(ERROR_TRANSLATIONS)) {
        if (error.toLowerCase().includes(key.toLowerCase())) {
            return value;
        }
    }
    return error;
}

interface ValidationState {
    email: boolean;
    name: boolean;
    password: boolean;
    confirm: boolean;
    terms: boolean;
}

const validationState: ValidationState = {
    email: false,
    name: false,
    password: false,
    confirm: false,
    terms: false
};

function showScreen(screenId: string): void {
    document.querySelectorAll('.screen').forEach((el) => {
        el.classList.add('hidden');
    });
    document.getElementById(screenId)?.classList.remove('hidden');
}

function setFieldError(fieldId: string, message: string): void {
    let errorEl = document.getElementById(`${fieldId}-error`);
    if (!errorEl && fieldId === 'register-password-confirm') {
        errorEl = document.getElementById('register-password-confirm-error');
    }

    const input = document.getElementById(fieldId) as HTMLInputElement;
    if (errorEl) {
        errorEl.textContent = message;
    }
    if (input) {
        input.classList.toggle('input-error', !!message);
        input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
}

function updateSubmitButton(): void {
    const btn = document.getElementById('email-register-btn') as HTMLButtonElement;
    if (!btn) return;
    const allValid = Object.values(validationState).every(Boolean);
    btn.disabled = !allValid;
}

function validateEmail(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) {
        setFieldError('register-email', 'El email es obligatorio');
        return false;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
        setFieldError('register-email', 'Introduce un email válido');
        return false;
    }
    setFieldError('register-email', '');
    return true;
}

function validateName(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) {
        setFieldError('register-name', 'El nombre es obligatorio');
        return false;
    }
    if (trimmed.length < 2) {
        setFieldError('register-name', 'El nombre debe tener al menos 2 caracteres');
        return false;
    }
    setFieldError('register-name', '');
    return true;
}

function validatePassword(value: string): boolean {
    if (!value) {
        setFieldError('register-password', 'La contraseña es obligatoria');
        return false;
    }
    if (value.length < 8) {
        setFieldError('register-password', 'Mínimo 8 caracteres');
        return false;
    }
    if (!PASSWORD_REGEX.test(value)) {
        setFieldError('register-password', 'Debe incluir mayúscula, minúscula y número');
        return false;
    }
    setFieldError('register-password', '');
    return true;
}

function validateConfirm(password: string, confirm: string): boolean {
    if (!confirm) {
        setFieldError('register-password-confirm', 'Confirma tu contraseña');
        return false;
    }
    if (password !== confirm) {
        setFieldError('register-password-confirm', 'Las contraseñas no coinciden');
        return false;
    }
    setFieldError('register-password-confirm', '');
    return true;
}

function validateTerms(): boolean {
    const termsCheckbox = document.getElementById('register-terms') as HTMLInputElement;
    if (!termsCheckbox) {
        validationState.terms = true;
        return true;
    }
    if (!termsCheckbox.checked) {
        setFieldError('register-terms', 'Debes aceptar los términos y condiciones');
        return false;
    }
    setFieldError('register-terms', '');
    return true;
}

function updatePasswordStrength(password: string): void {
    const strengthBar = document.getElementById('password-strength-bar');
    const strengthLabel = document.getElementById('password-strength-label');
    if (!strengthBar || !strengthLabel) return;

    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasLength = password.length >= 8;
    
    const score = [hasLower, hasUpper, hasNumber, hasLength].filter(Boolean).length;
    
    strengthBar.classList.remove('weak', 'medium', 'strong');
    
    if (password.length === 0) {
        strengthLabel.textContent = '';
        return;
    }
    
    if (score <= 2) {
        strengthBar.classList.add('weak');
        strengthLabel.textContent = 'Débil';
    } else if (score === 3) {
        strengthBar.classList.add('medium');
        strengthLabel.textContent = 'Media';
    } else {
        strengthBar.classList.add('strong');
        strengthLabel.textContent = 'Fuerte';
    }
}

function updatePasswordRequirements(password: string): void {
    const requirements = {
        'req-length': password.length >= 8,
        'req-upper': /[A-Z]/.test(password),
        'req-lower': /[a-z]/.test(password),
        'req-number': /\d/.test(password)
    };
    
    for (const [id, met] of Object.entries(requirements)) {
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('met', met);
            el.classList.toggle('unmet', !met);
            const icon = met ? '✓' : '✗';
            const text = el.textContent?.replace(/^[✓✗]\s*/, '') || '';
            el.textContent = `${icon} ${text}`;
        }
    }
}

function validateAllFields(): void {
    const emailInput = document.getElementById('register-email') as HTMLInputElement;
    const nameInput = document.getElementById('register-name') as HTMLInputElement;
    const passwordInput = document.getElementById('register-password') as HTMLInputElement;
    const confirmInput = document.getElementById('register-password-confirm') as HTMLInputElement;
    const termsCheckbox = document.getElementById('register-terms') as HTMLInputElement;

    if (!emailInput || !nameInput || !passwordInput || !confirmInput) return;

    if (emailInput.value) {
        validationState.email = validateEmail(emailInput.value);
    }
    if (nameInput.value) {
        validationState.name = validateName(nameInput.value);
    }
    if (passwordInput.value) {
        validationState.password = validatePassword(passwordInput.value);
        updatePasswordStrength(passwordInput.value);
        updatePasswordRequirements(passwordInput.value);
    }
    if (confirmInput.value && passwordInput.value) {
        validationState.confirm = validateConfirm(passwordInput.value, confirmInput.value);
    }
    if (termsCheckbox) {
        validationState.terms = termsCheckbox.checked;
    } else {
        validationState.terms = true;
    }
    updateSubmitButton();
}

function setupRegisterValidation(): void {
    const emailInput = document.getElementById('register-email') as HTMLInputElement;
    const nameInput = document.getElementById('register-name') as HTMLInputElement;
    const passwordInput = document.getElementById('register-password') as HTMLInputElement;
    const confirmInput = document.getElementById('register-password-confirm') as HTMLInputElement;
    const termsCheckbox = document.getElementById('register-terms') as HTMLInputElement;

    if (!emailInput || !nameInput || !passwordInput || !confirmInput) return;

    emailInput.addEventListener('input', () => {
        validationState.email = validateEmail(emailInput.value);
        updateSubmitButton();
    });

    emailInput.addEventListener('blur', () => {
        validationState.email = validateEmail(emailInput.value);
        updateSubmitButton();
    });

    nameInput.addEventListener('input', () => {
        validationState.name = validateName(nameInput.value);
        updateSubmitButton();
    });

    nameInput.addEventListener('blur', () => {
        validationState.name = validateName(nameInput.value);
        updateSubmitButton();
    });

    passwordInput.addEventListener('input', () => {
        validationState.password = validatePassword(passwordInput.value);
        updatePasswordStrength(passwordInput.value);
        updatePasswordRequirements(passwordInput.value);
        if (confirmInput.value) {
            validationState.confirm = validateConfirm(passwordInput.value, confirmInput.value);
        }
        updateSubmitButton();
    });

    confirmInput.addEventListener('input', () => {
        validationState.confirm = validateConfirm(passwordInput.value, confirmInput.value);
        updateSubmitButton();
    });

    if (termsCheckbox) {
        termsCheckbox.addEventListener('change', () => {
            validationState.terms = validateTerms();
            updateSubmitButton();
        });
    }

    setupPasswordToggle();

    requestAnimationFrame(() => {
        setTimeout(validateAllFields, 300);
    });
}

function setupPasswordToggle(): void {
    const toggleBtn = document.getElementById('toggle-register-password');
    const passwordInput = document.getElementById('register-password') as HTMLInputElement;
    const confirmInput = document.getElementById('register-password-confirm') as HTMLInputElement;
    const toggleConfirmBtn = document.getElementById('toggle-register-password-confirm');

    if (toggleBtn && passwordInput) {
        toggleBtn.addEventListener('click', () => {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
            toggleBtn.textContent = isPassword ? '🙈' : '👁️';
            toggleBtn.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
        });
    }

    if (toggleConfirmBtn && confirmInput) {
        toggleConfirmBtn.addEventListener('click', () => {
            const isPassword = confirmInput.type === 'password';
            confirmInput.type = isPassword ? 'text' : 'password';
            toggleConfirmBtn.textContent = isPassword ? '🙈' : '👁️';
            toggleConfirmBtn.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
        });
    }
}

function setupRegisterUI(): void {
    if (cpInitialized) return;
    cpInitialized = true;

    const registerLink = document.getElementById('goto-register-link');
    if (registerLink) {
        registerLink.classList.remove('hidden');
    }
    
    document.getElementById('goto-register-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        showScreen('register-screen');
        setTimeout(() => {
            void googleAuth.renderButton('google-signup-btn');
        }, 100);
    });

    document.getElementById('goto-login-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        showScreen('login-screen');
    });

    setupRegisterValidation();

    document.getElementById('email-register-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        void handleRegister();
    });
}

async function handleRegister(): Promise<void> {
    if (isSubmitting) return;

    const emailInput = document.getElementById('register-email') as HTMLInputElement;
    const nameInput = document.getElementById('register-name') as HTMLInputElement;
    const passwordInput = document.getElementById('register-password') as HTMLInputElement;
    const confirmInput = document.getElementById('register-password-confirm') as HTMLInputElement;
    const btn = document.getElementById('email-register-btn') as HTMLButtonElement;
    const errorEl = document.getElementById('register-error');

    if (errorEl) errorEl.textContent = '';

    const email = emailInput.value.trim();
    const name = nameInput.value.trim();
    const password = passwordInput.value;
    const confirm = confirmInput.value;

    const emailValid = validateEmail(email);
    const nameValid = validateName(name);
    const passwordValid = validatePassword(password);
    const confirmValid = validateConfirm(password, confirm);
    const termsValid = validateTerms();

    if (!emailValid || !nameValid || !passwordValid || !confirmValid || !termsValid) {
        return;
    }

    isSubmitting = true;
    btn.disabled = true;
    btn.classList.add('is-loading');
    const originalText = btn.textContent || 'Crear cuenta';
    btn.innerHTML = '<span class="spinner"></span> Creando...';

    emailInput.disabled = true;
    nameInput.disabled = true;
    passwordInput.disabled = true;
    confirmInput.disabled = true;

    try {
        await auth.register(email, name, password);
        await auth.login(email, password);
        showToast('Cuenta creada correctamente', 'success');
        await new Promise(resolve => setTimeout(resolve, 1500));
        window.location.reload();
    } catch (err) {
        const rawMessage = err instanceof Error ? err.message : 'Error al crear la cuenta';
        const message = translateError(rawMessage);
        if (errorEl) errorEl.textContent = message;
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.textContent = originalText;
        emailInput.disabled = false;
        nameInput.disabled = false;
        passwordInput.disabled = false;
        confirmInput.disabled = false;
    } finally {
        isSubmitting = false;
    }
}

export async function init(): Promise<void> {
    console.log('[cp-init] Initializing...');
    if (!auth.isAuthenticated()) {
        console.log('[cp-init] Not authenticated, showing login');
        setupRegisterUI();
        await openpathInit();
        return;
    }

    let status: OnboardingState;
    try {
        console.log('[cp-init] Checking onboarding status...');
        status = await onboarding.checkStatus();
        console.log('[cp-init] Onboarding status:', status);
    } catch (error) {
        console.error('[cp-init] Onboarding check failed with exception:', error);
        setupRegisterUI();
        await openpathInit();
        return;
    }

    if (!status.hasMembership) {
        console.log('[cp-init] No membership, showing onboarding UI');
        onboarding.initUI();
        
        if (status.isWaiting) {
            console.log('[cp-init] Showing waiting screen');
            showScreen('waiting-screen');
        } else {
            console.log('[cp-init] Showing onboarding screen');
            showScreen('onboarding-screen');
            
            document.getElementById('show-create-form-btn')?.addEventListener('click', () => {
                document.getElementById('create-org-form')?.classList.remove('hidden');
                document.getElementById('show-create-form-btn')?.classList.add('hidden');
                document.getElementById('org-name-input')?.focus();
            });
        }
        return;
    }

    console.log(`[cp-init] User belongs to org: ${status.organization?.name} as ${status.organization?.role}`);
    return openpathInit();
}
