import { cpTrpc } from './cp-trpc.js';
import { auth } from '../../upstream/openpath/spa/src/auth.js';

export interface OnboardingState {
    hasMembership: boolean;
    isWaiting: boolean;
    organization: {
        id: string;
        name: string;
        role: string;
    } | null;
}

let currentStatus: OnboardingState | null = null;

export const onboarding = {
    async checkStatus(): Promise<OnboardingState> {
        try {
            const status = await cpTrpc.onboarding.status.query();
            currentStatus = status;
            return status;
        } catch (error) {
            console.error('Failed to check onboarding status:', error);
            // Assume no membership on error
            return { hasMembership: false, isWaiting: false, organization: null };
        }
    },

    getStatus(): OnboardingState | null {
        return currentStatus;
    },

    async createOrganization(name: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await cpTrpc.onboarding.createOrganization.mutate({ name });
            
            if (result.accessToken) {
                auth.storeTokens({
                    accessToken: result.accessToken,
                    refreshToken: result.refreshToken,
                    expiresIn: '24h',
                    tokenType: 'Bearer'
                });
                
                // CRITICAL FIX (BUG-001): Fetch and cache updated user with new admin role
                // This ensures localStorage.openpath_user contains the admin role
                // BEFORE page reload triggers dashboard initialization
                // Without this, the cached user has stale roles → 403 on /trpc/groups.list
                await auth.getMe();
            }
            
            return { success: true };
        } catch (error) {
            console.error('Failed to create organization:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { success: false, error: errorMessage };
        }
    },

    async waitForInvitation(): Promise<boolean> {
        try {
            await cpTrpc.onboarding.waitForInvitation.mutate();
            return true;
        } catch (error) {
            console.error('Failed to set waiting status:', error);
            return false;
        }
    },

    async cancelWaiting(): Promise<boolean> {
        try {
            await cpTrpc.onboarding.cancelWaiting.mutate();
            return true;
        } catch (error) {
            console.error('Failed to cancel waiting:', error);
            return false;
        }
    },

    initUI(): void {
        // Create organization form handler
        const createOrgForm = document.getElementById('create-org-form');
        createOrgForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('org-name-input') as HTMLInputElement;
            const name = input?.value?.trim();
            
            if (!name) return;
            
            const btn = document.getElementById('create-org-submit') as HTMLButtonElement;
            btn.disabled = true;
            btn.textContent = 'Creando...';
            
            const result = await this.createOrganization(name);
            
            if (result.success) {
                window.location.reload();
            } else {
                // Check if error is "already belongs to organization"
                if (result.error?.includes('already belongs to an organization')) {
                    // Organization was actually created, reload to redirect to dashboard
                    window.location.reload();
                } else {
                    btn.disabled = false;
                    btn.textContent = 'Crear organización';
                    const error = document.getElementById('create-org-error');
                    if (error) error.textContent = 'Error al crear la organización';
                }
            }
        });

        // Wait for invitation button
        document.getElementById('wait-invite-btn')?.addEventListener('click', async () => {
            const success = await this.waitForInvitation();
            if (success) {
                showScreen('waiting-screen');
            }
        });

        // Reload button on waiting screen
        document.getElementById('reload-status-btn')?.addEventListener('click', () => {
            window.location.reload();
        });

        // Change mind button
        document.getElementById('change-mind-btn')?.addEventListener('click', async () => {
            await this.cancelWaiting();
            showScreen('onboarding-screen');
        });

        // Create org from waiting screen
        document.getElementById('create-org-from-waiting-btn')?.addEventListener('click', async () => {
            await this.cancelWaiting();
            showScreen('onboarding-screen');
        });
    },
};

function showScreen(screenId: string): void {
    document.querySelectorAll('.screen').forEach((el) => {
        el.classList.add('hidden');
    });
    document.getElementById(screenId)?.classList.remove('hidden');
}
