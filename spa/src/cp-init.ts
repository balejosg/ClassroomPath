import { auth } from '../../upstream/openpath/spa/src/auth.js';
import { onboarding } from './onboarding.js';
import './styles/onboarding.css';

export * from '../../upstream/openpath/spa/src/modules/app-core.js';

import { init as openpathInit } from '../../upstream/openpath/spa/src/modules/app-core.js';
import { googleAuth } from '../../upstream/openpath/spa/src/google-auth.js';
import { showToast } from '../../upstream/openpath/spa/src/utils.js';

let cpInitialized = false;

function showScreen(screenId: string): void {
    document.querySelectorAll('.screen').forEach((el) => {
        el.classList.add('hidden');
    });
    document.getElementById(screenId)?.classList.remove('hidden');
}

function setupRegisterUI(): void {
    if (cpInitialized) return;
    cpInitialized = true;

    const loginInfo = document.querySelector('#login-screen .login-info');
    if (loginInfo && !document.getElementById('goto-register-link')) {
        loginInfo.innerHTML = '¿No tienes cuenta? <a href="#" id="goto-register-link">Crear cuenta</a>';
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

    if (passwordInput.value.length < 8) {
        if (errorEl) errorEl.textContent = 'La contraseña debe tener al menos 8 caracteres';
        return;
    }

    if (passwordInput.value !== confirmInput.value) {
        if (errorEl) errorEl.textContent = 'Las contraseñas no coinciden';
        return;
    }

    btn.disabled = true;
    btn.classList.add('is-loading');
    const originalText = btn.textContent || 'Crear cuenta';
    btn.innerHTML = '<span class="spinner"></span> Creando...';

    try {
        await auth.register(emailInput.value, nameInput.value, passwordInput.value);
        await auth.login(emailInput.value, passwordInput.value);
        showToast('Cuenta creada correctamente', 'success');
        window.location.reload();
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Error al crear la cuenta';
        if (errorEl) errorEl.textContent = message;
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.textContent = originalText;
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
