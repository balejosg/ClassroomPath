import { getErrorMessage, normalize } from '@openpath/shared';
import './styles/onboarding.css';
import { init } from './cp-init.js';
import { pushManager } from '@/push.js';
import { initUsersListeners } from '@/modules/users.js';
import { initClassroomListeners, initMachineListeners } from '@/modules/classrooms.js';
import { initModals, showScreen, openModal, closeModal, initTheme, toggleTheme } from '@/modules/ui.js';
import { navigateToScreen, updateIcons, initSidebar } from './ui-extensions.js';
import { auth } from '@/auth.js';
import { googleAuth } from '@/google-auth.js';
import { setup } from '@/setup.js';
import { showToast } from '@/utils.js';
import { state } from '@/modules/state.js';
import { loadDashboard, renderRules, saveCurrentGroup, deleteGroup } from '@/modules/groups.js';
import { logger } from '@/lib/logger.js';
import { getElement, requireElement } from '@/lib/dom.js';
import { trpc } from '@/trpc.js';

document.addEventListener('DOMContentLoaded', () => void (async () => {
    logger.info('OpenPath SPA initializing...');

    initTheme();
    initModals();
    initUsersListeners();
    initClassroomListeners();
    initMachineListeners();
    initMainListeners();

    if (googleAuth.isConfigured()) {
        googleAuth.init();
    }

    await init();

    try {
        await pushManager.init();
    } catch (e) {
        logger.warn('Push init failed', { error: getErrorMessage(e) });
    }
})());

function initMainListeners() {
    getElement('setup-form')?.addEventListener('submit', (e) => void (async () => {
        e.preventDefault();
        
        const emailInput = requireElement<HTMLInputElement>('setup-email');
        const nameInput = requireElement<HTMLInputElement>('setup-name');
        const passwordInput = requireElement<HTMLInputElement>('setup-password');
        const confirmInput = requireElement<HTMLInputElement>('setup-password-confirm');
        const btn = requireElement<HTMLButtonElement>('setup-submit-btn');
        const errorEl = getElement('setup-error');

        errorEl?.classList.add('hidden');

        if (passwordInput.value.length < 8) {
            if (errorEl) {
                errorEl.textContent = 'La contraseña debe tener al menos 8 caracteres';
                errorEl.classList.remove('hidden');
            }
            return;
        }

        if (passwordInput.value !== confirmInput.value) {
            if (errorEl) {
                errorEl.textContent = 'Las contraseñas no coinciden';
                errorEl.classList.remove('hidden');
            }
            return;
        }

        btn.disabled = true;
        btn.classList.add('is-loading');
        const originalText = btn.textContent || 'Crear administrador';
        btn.innerHTML = '<span class="spinner"></span> Creando...';

        try {
            const result = await setup.createFirstAdmin(
                emailInput.value,
                nameInput.value,
                passwordInput.value
            );
            setup.showSetupComplete(result.registrationToken);
        } catch (err) {
            if (errorEl) {
                errorEl.textContent = getErrorMessage(err);
                errorEl.classList.remove('hidden');
            }
            btn.disabled = false;
            btn.classList.remove('is-loading');
            btn.textContent = originalText;
        }
    })());

    getElement('goto-login-btn')?.addEventListener('click', () => {
        showScreen('login-screen');
    });

    getElement('setup-goto-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        showScreen('login-screen');
    });

    getElement('email-login-form')?.addEventListener('submit', (e) => void (async () => {
        e.preventDefault();
        const emailInput = requireElement<HTMLInputElement>('login-email');
        const passwordInput = requireElement<HTMLInputElement>('login-password');
        const btn = requireElement<HTMLButtonElement>('email-login-btn');

        btn.disabled = true;
        btn.classList.add('is-loading');
        const originalText = btn.textContent;
        btn.innerHTML = '<span class="spinner"></span> <span class="btn-text">Autenticando...</span>';

        emailInput.disabled = true;
        passwordInput.disabled = true;

        try {
            console.warn('[login] Attempting login with email:', emailInput.value);
            await auth.login(emailInput.value, passwordInput.value);
            console.warn('[login] Login successful, calling init()');
            await init();
            console.warn('[login] init() completed');
        } catch (err) {
            console.error('[login] Login failed:', err);
            showToast('Credenciales inválidas. Por favor, verifica tu email y contraseña.', 'error');
            emailInput.disabled = false;
            passwordInput.disabled = false;
            btn.disabled = false;
            btn.classList.remove('is-loading');
            btn.textContent = originalText;
        }
    })());

    document.getElementById('forgot-password-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        openModal('modal-forgot-password');
    });

    document.getElementById('toggle-password-btn')?.addEventListener('click', (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const input = document.getElementById('login-password') as HTMLInputElement;

        if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '🔒';
            btn.setAttribute('aria-label', 'Ocultar contraseña');
            btn.title = 'Ocultar contraseña';
        } else {
            input.type = 'password';
            btn.textContent = '👁️';
            btn.setAttribute('aria-label', 'Mostrar contraseña');
            btn.title = 'Mostrar contraseña';
        }
    });


    document.getElementById('notifications-btn')?.addEventListener('click', () => void (async () => {
        if (!pushManager.isSupported()) {
            showToast('Your browser does not support push notifications', 'error');
            return;
        }

        const btn = document.getElementById('notifications-btn') as HTMLButtonElement;
        const icon = document.getElementById('notifications-icon');

        try {
            const subscription = await pushManager.getSubscription();

            if (subscription) {
                if (confirm('Disable push notifications?')) {
                    await pushManager.unsubscribe();
                    if (icon) icon.textContent = '🔕';
                    showToast('Notifications disabled');
                }
            } else {
                btn.disabled = true;
                if (icon) icon.textContent = '⏳';
                await pushManager.subscribe();
                if (icon) icon.textContent = '🔔';
                showToast('Notifications enabled! You will receive alerts when a student requests access.');
            }
        } catch (err: unknown) {
            const message = getErrorMessage(err);
            logger.error('Push notification error', { error: message });
            if (icon) icon.textContent = '🔕';
            if (message.includes('denied')) {
                showToast('Notification permission denied. Enable it in browser settings.', 'error');
            } else {
                showToast('Error setting up notifications: ' + message, 'error');
            }
        } finally {
            btn.disabled = false;
        }
    })());

    document.getElementById('logout-btn')?.addEventListener('click', () => {
        if (confirm('Log out?')) {
            googleAuth.logout();
            void auth.logout();
            showScreen('login-screen');
        }
    });

    document.getElementById('admin-users-btn')?.addEventListener('click', () => {
        document.getElementById('users-section')?.scrollIntoView({ behavior: 'smooth' });
    });

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const rawType = (tab as HTMLElement).dataset.type;
            let type: 'whitelist' | 'blockedSubdomains' | 'blockedPaths' = 'whitelist';
            if (rawType === 'blockedSubdomains') type = 'blockedSubdomains';
            else if (rawType === 'blockedPaths') type = 'blockedPaths';

            state.currentRuleType = type;
            document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); });
            tab.classList.add('active');
            renderRules();
        });
    });

    document.getElementById('search-rules')?.addEventListener('input', () => { renderRules(); });

    document.getElementById('back-btn')?.addEventListener('click', () => {
        showScreen('dashboard-screen');
        navigateToScreen('overview-screen');
        void loadDashboard();
    });

    document.getElementById('save-config-btn')?.addEventListener('click', () => void (async () => {
        if (!state.canEdit || !state.currentGroupData) return;
        const enabledSelect = document.getElementById('group-enabled') as HTMLSelectElement;
        state.currentGroupData.enabled = enabledSelect.value === '1';
        await saveCurrentGroup('Update group status');
    })());

    document.getElementById('delete-group-btn')?.addEventListener('click', () => {
        void deleteGroup();
    });

    document.getElementById('copy-url-btn')?.addEventListener('click', () => void (async () => {
        const urlEl = document.getElementById('export-url');
        if (!urlEl) return;

        const text = urlEl.textContent;
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);
            showToast('URL copied to clipboard');
        } catch (e) {
            logger.warn('Failed to copy URL', { error: getErrorMessage(e) });
            showToast('Failed to copy URL', 'error');
        }
    })());

    document.getElementById('copy-registration-token-btn')?.addEventListener('click', () => {
        const tokenEl = document.getElementById('setup-registration-token');
        const token = tokenEl?.textContent.trim();
        if (!token) {
            showToast('No token to copy', 'error');
            return;
        }
        void (async () => {
            try {
                await navigator.clipboard.writeText(token);
                showToast('Token copied to clipboard');
            } catch (e) {
                logger.warn('Failed to copy registration token', { error: getErrorMessage(e) });
                showToast('Failed to copy token', 'error');
            }
        })();
    });

    document.getElementById('add-rule-btn')?.addEventListener('click', () => {
        if (!state.canEdit) return;
        openModal('modal-add-rule');
    });

    getElement('add-rule-form')?.addEventListener('submit', (e) => void (async () => {
        e.preventDefault();
        if (!state.canEdit || !state.currentGroupData) return;

        const input = requireElement<HTMLInputElement>('new-rule-value');
        const value = normalize.domain(input.value);

        if (!value) {
            showToast('Value required', 'error');
            return;
        }

        const typeKey = state.currentRuleType;
        const list = state.currentGroupData[typeKey];
        if (list.includes(value)) {
            showToast('Rule already exists', 'error');
            return;
        }

        state.currentGroupData[typeKey].push(value);
        await saveCurrentGroup(`Add ${value} to ${state.currentGroup ?? ''}`);

        closeModal('modal-add-rule');
        (document.getElementById('add-rule-form') as HTMLFormElement).reset();
    })());

    document.getElementById('bulk-add-btn')?.addEventListener('click', () => {
        if (!state.canEdit) return;
        openModal('modal-bulk-add');
    });

    getElement('bulk-add-form')?.addEventListener('submit', (e) => void (async () => {
        e.preventDefault();
        if (!state.canEdit || !state.currentGroupData) return;

        const input = requireElement<HTMLTextAreaElement>('bulk-values');
        const text = input.value;
        const values = text.split('\n').map(v => normalize.domain(v)).filter(v => v);

        if (values.length === 0) {
            showToast('No values to add', 'error');
            return;
        }

        const typeKey = state.currentRuleType;
        let added = 0;

        for (const value of values) {
            if (!state.currentGroupData[typeKey].includes(value)) {
                state.currentGroupData[typeKey].push(value);
                added++;
            }
        }

        if (added > 0) {
            await saveCurrentGroup(`Add ${added.toString()} rules to ${state.currentGroup ?? ''}`);
        }

        closeModal('modal-bulk-add');
        (document.getElementById('bulk-add-form') as HTMLFormElement).reset();
        showToast(`${added.toString()} rules added`);
    })());

    document.getElementById('new-group-form')?.addEventListener('submit', (e) => void (async () => {
        e.preventDefault();
        if (!state.canEdit) return;

        const input = document.getElementById('new-group-name') as HTMLInputElement;
        const name = input.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

        if (!name) {
            showToast('Name required', 'error');
            return;
        }

        try {
            await trpc.groups.create.mutate({ name, displayName: name });
            closeModal('modal-new-group');
            (document.getElementById('new-group-form') as HTMLFormElement).reset();
            showToast('Group created');
            void loadDashboard();
        } catch (err: unknown) {
            if (err instanceof Error) showToast(err.message, 'error');
        }
    })());

    document.getElementById('new-group-btn')?.addEventListener('click', () => {
        if (!state.canEdit) return;
        openModal('modal-new-group');
    });

    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
        toggleTheme();
    });

    initSidebar();
    updateIcons(document);

    if (document.getElementById('dashboard-screen') && !document.getElementById('dashboard-screen')?.classList.contains('hidden')) {
        navigateToScreen('overview-screen');
    }
}
