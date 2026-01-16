/**
 * ClassroomPath-specific UI extensions
 * These extend OpenPath's base UI functionality with ClassroomPath-specific features
 */

/**
 * Check if Lucide icons library is available
 */
function isLucideAvailable(): boolean {
    const win = window as unknown as { lucide?: { createIcons: (options?: { root?: ParentNode }) => void } };
    return typeof win.lucide !== 'undefined';
}

/**
 * Update page title
 */
function updatePageTitle(title: string): void {
    document.title = title;
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) pageTitle.textContent = title;
}

/**
 * Set active navigation item
 */
function setActiveNavItem(screenId: string): void {
    document.querySelectorAll('.nav-item').forEach((el) => {
        el.classList.remove('active');
    });

    const navItem = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
    navItem?.classList.add('active');
}

/**
 * Update Lucide icons in the DOM
 */
export function updateIcons(root: ParentNode = document): void {
    const win = window as unknown as { lucide?: { createIcons: (options?: { root?: ParentNode }) => void } };
    if (!win.lucide) return;
    win.lucide.createIcons({ root });
}

/**
 * Navigate to a specific screen in the ClassroomPath dashboard
 */
export function navigateToScreen(screenId: string): void {
    document.querySelectorAll('.main-content .screen').forEach((el) => {
        el.classList.add('hidden');
    });

    document.getElementById(screenId)?.classList.remove('hidden');

    setActiveNavItem(screenId);

    const titles: Record<string, string> = {
        'overview-screen': 'Dashboard',
        'classrooms-screen': 'Gestión de Aulas',
        'groups-screen': 'Grupos',
        'users-screen': 'Usuarios',
        'requests-screen': 'Solicitudes',
    };

    updatePageTitle(titles[screenId] ?? 'ClassroomPath');

    if (isLucideAvailable()) updateIcons(document.getElementById(screenId) ?? document);
}
