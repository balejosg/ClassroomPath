/**
 * ClassroomPath Init Wrapper
 * 
 * This module wraps OpenPath's init() to add onboarding check.
 * Import this instead of OpenPath's app-core when building ClassroomPath SPA.
 */

import { auth } from '../../upstream/openpath/spa/src/auth.js';
import { onboarding } from './onboarding.js';
import './styles/onboarding.css';

// Re-export everything from OpenPath's app-core
export * from '../../upstream/openpath/spa/src/modules/app-core.js';

// Import the original init
import { init as openpathInit } from '../../upstream/openpath/spa/src/modules/app-core.js';

function showScreen(screenId: string): void {
    document.querySelectorAll('.screen').forEach((el) => {
        el.classList.add('hidden');
    });
    document.getElementById(screenId)?.classList.remove('hidden');
}

/**
 * ClassroomPath init - adds onboarding check before OpenPath init
 */
export async function init(): Promise<void> {
    // If not authenticated, let OpenPath handle login
    if (!auth.isAuthenticated()) {
        return openpathInit();
    }

    // Check onboarding status
    const status = await onboarding.checkStatus();

    if (!status.hasMembership) {
        // User has no organization - show onboarding
        onboarding.initUI();
        
        if (status.isWaiting) {
            showScreen('waiting-screen');
        } else {
            showScreen('onboarding-screen');
            
            // Setup show form button
            document.getElementById('show-create-form-btn')?.addEventListener('click', () => {
                document.getElementById('create-org-form')?.classList.remove('hidden');
                document.getElementById('show-create-form-btn')?.classList.add('hidden');
                document.getElementById('org-name-input')?.focus();
            });
        }
        return;
    }

    // User has organization - proceed with OpenPath
    console.log(`User belongs to org: ${status.organization?.name} as ${status.organization?.role}`);
    return openpathInit();
}
