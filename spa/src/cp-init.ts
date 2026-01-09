import { auth } from '../../upstream/openpath/spa/src/auth.js';
import { onboarding } from './onboarding.js';

import { init as openpathInit, updateEditUI } from '../../upstream/openpath/spa/src/modules/app-core.js';
import { googleAuth } from '../../upstream/openpath/spa/src/google-auth.js';
import { showToast } from '../../upstream/openpath/spa/src/utils.js';

export { updateEditUI };

let cpInitialized = false;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

interface ValidationState {
    email: boolean;
    name: boolean;
    password: boolean;
    confirm: boolean;
}

const validationState: ValidationState = {
    email: false,
    name: false,
    password: false,
    confirm: false
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
    if (errorEl) errorEl.textContent = message;
    if (input) input.classList.toggle('input-error', !!message);
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

function validateAllFields(): void {
    const emailInput = document.getElementById('register-email') as HTMLInputElement;
    const nameInput = document.getElementById('register-name') as HTMLInputElement;
    const passwordInput = document.getElementById('register-password') as HTMLInputElement;
    const confirmInput = document.getElementById('register-password-confirm') as HTMLInputElement;

    if (!emailInput || !nameInput || !passwordInput || !confirmInput) return;

    // Validate all fields silently (without showing errors for empty fields)
    if (emailInput.value) {
        validationState.email = validateEmail(emailInput.value);
    }
    if (nameInput.value) {
        validationState.name = validateName(nameInput.value);
    }
    if (passwordInput.value) {
        validationState.password = validatePassword(passwordInput.value);
    }
    if (confirmInput.value && passwordInput.value) {
        validationState.confirm = validateConfirm(passwordInput.value, confirmInput.value);
    }
    updateSubmitButton();
}

function setupRegisterValidation(): void {
    const emailInput = document.getElementById('register-email') as HTMLInputElement;
    const nameInput = document.getElementById('register-name') as HTMLInputElement;
    const passwordInput = document.getElementById('register-password') as HTMLInputElement;
    const confirmInput = document.getElementById('register-password-confirm') as HTMLInputElement;

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
        if (confirmInput.value) {
            validationState.confirm = validateConfirm(passwordInput.value, confirmInput.value);
        }
        updateSubmitButton();
    });

    confirmInput.addEventListener('input', () => {
        validationState.confirm = validateConfirm(passwordInput.value, confirmInput.value);
        updateSubmitButton();
    });

    // Handle browser autocomplete: validate after a short delay to catch autofilled values
    setTimeout(() => {
        validateAllFields();
    }, 100);
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
        void googleAuth.renderButton('google-signup-btn');
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

    if (!emailValid || !nameValid || !passwordValid || !confirmValid) {
        return;
    }

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
        window.location.reload();
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Error al crear la cuenta';
        if (errorEl) errorEl.textContent = message;
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.textContent = originalText;
        emailInput.disabled = false;
        nameInput.disabled = false;
        passwordInput.disabled = false;
        confirmInput.disabled = false;
    }
}

export async function init(): Promise<void> {
    if (!auth.isAuthenticated()) {
        await openpathInit();
        setupRegisterUI();
        return;
    }

    const status = await onboarding.checkStatus();

    if (!status.hasMembership) {
        onboarding.initUI();
        
        if (status.isWaiting) {
            showScreen('waiting-screen');
        } else {
            showScreen('onboarding-screen');
            
            document.getElementById('show-create-form-btn')?.addEventListener('click', () => {
                document.getElementById('create-org-form')?.classList.remove('hidden');
                document.getElementById('show-create-form-btn')?.classList.add('hidden');
                document.getElementById('org-name-input')?.focus();
            });
        }
        return;
    }

    console.log(`User belongs to org: ${status.organization?.name} as ${status.organization?.role}`);
    return openpathInit();
}
