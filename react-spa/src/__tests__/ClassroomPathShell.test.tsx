import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockIsAdmin = vi.fn();

vi.mock('@openpath/src/components/Sidebar', () => ({
  default: ({
    setActiveTab,
  }: {
    activeTab: string;
    isOpen: boolean;
    setActiveTab: (tab: string) => void;
  }) => (
    <nav>
      <button onClick={() => setActiveTab('users')}>Usuarios y Roles</button>
      <button onClick={() => setActiveTab('classrooms')}>Aulas</button>
      <button onClick={() => setActiveTab('groups')}>Políticas</button>
      <button onClick={() => setActiveTab('domains')}>Dominios</button>
      <button onClick={() => setActiveTab('settings')}>Configuración</button>
      <button onClick={() => setActiveTab('unknown')}>Tab inválida</button>
    </nav>
  ),
}));

vi.mock('@openpath/src/components/Header', () => ({
  default: ({ title, onMenuClick }: { title: string; onMenuClick: () => void }) => (
    <header>
      <button onClick={onMenuClick}>Abrir menú</button>
      <h1>{title}</h1>
    </header>
  ),
}));

vi.mock('@openpath/src/views/Dashboard', () => ({
  default: ({
    onNavigateToRules,
  }: {
    onNavigateToRules: (group: { id: string; name: string; readOnly?: boolean }) => void;
  }) => (
    <div>
      <div>Dashboard View</div>
      <button onClick={() => onNavigateToRules({ id: 'grp-1', name: 'Grupo Demo' })}>
        Dashboard a reglas
      </button>
    </div>
  ),
}));

vi.mock('@openpath/src/views/TeacherDashboard', () => ({
  default: ({
    onNavigateToRules,
  }: {
    onNavigateToRules: (group: { id: string; name: string; readOnly?: boolean }) => void;
  }) => (
    <div>
      <div>Teacher Dashboard View</div>
      <button onClick={() => onNavigateToRules({ id: 'grp-2', name: 'Grupo Docente' })}>
        Teacher a reglas
      </button>
    </div>
  ),
}));

vi.mock('@openpath/src/views/Classrooms', () => ({
  default: () => <div>Classrooms View</div>,
}));

vi.mock('@openpath/src/views/Groups', () => ({
  default: ({
    onNavigateToRules,
  }: {
    onNavigateToRules: (group: { id: string; name: string; readOnly?: boolean }) => void;
  }) => (
    <div>
      <div>Groups View</div>
      <button onClick={() => onNavigateToRules({ id: 'grp-3', name: 'Grupo de Ciencias' })}>
        Ir a reglas del grupo
      </button>
    </div>
  ),
}));

vi.mock('@openpath/src/views/Settings', () => ({
  default: () => <div>Settings View</div>,
}));

vi.mock('@openpath/src/views/DomainRequests', () => ({
  default: () => <div>Domain Requests View</div>,
}));

vi.mock('@openpath/src/views/RulesManager', () => ({
  default: ({
    groupName,
    onBack,
  }: {
    groupId: string;
    groupName: string;
    readOnly?: boolean;
    onBack: () => void;
  }) => (
    <div>
      <div>Rules Manager View</div>
      <div>Rules Manager for {groupName}</div>
      <button onClick={onBack}>Volver al grupo</button>
    </div>
  ),
}));

vi.mock('@openpath/src/lib/auth', () => ({
  isAdmin: () => mockIsAdmin(),
}));

vi.mock('../views/OrganizationUsers', () => ({
  OrganizationUsers: () => <div>Organization Users View</div>,
}));

import ClassroomPathShell from '../ClassroomPathShell';

describe('ClassroomPathShell', () => {
  beforeEach(() => {
    mockIsAdmin.mockReset();
    mockIsAdmin.mockReturnValue(true);
    window.history.pushState({}, '', '/usuarios');
  });

  it('renders the ClassroomPath users view for admins on the users route', () => {
    render(<ClassroomPathShell />);

    expect(screen.getByRole('heading', { name: 'Administración de Usuarios' })).toBeInTheDocument();
    expect(screen.getByText('Organization Users View')).toBeInTheDocument();
  });

  it('updates the active route and title when navigating through the sidebar', () => {
    render(<ClassroomPathShell />);

    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }));

    expect(screen.getByRole('heading', { name: 'Configuración' })).toBeInTheDocument();
    expect(screen.getByText('Settings View')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/configuracion');
  });

  it('reacts to browser history changes and renders admin routes from pathname aliases', async () => {
    window.history.pushState({}, '', '/grupos');

    render(<ClassroomPathShell />);

    expect(screen.getByRole('heading', { name: 'Grupos y Políticas' })).toBeInTheDocument();
    expect(screen.getByText('Groups View')).toBeInTheDocument();

    window.history.pushState({}, '', '/aulas');
    fireEvent.popState(window);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Gestión de Aulas' })).toBeInTheDocument();
    });
    expect(screen.getByText('Classrooms View')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dominios' }));

    expect(screen.getByRole('heading', { name: 'Solicitudes de Acceso' })).toBeInTheDocument();
    expect(screen.getByText('Domain Requests View')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/dominios');
  });

  it('opens the mobile menu overlay and closes it when the overlay is clicked', () => {
    render(<ClassroomPathShell />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));

    const overlay = document.querySelector('.fixed.inset-0.z-30');
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay as Element);

    expect(document.querySelector('.fixed.inset-0.z-30')).toBeNull();
  });

  it('navigates to rules for a selected group and can return to the groups view', () => {
    window.history.pushState({}, '', '/politicas');

    render(<ClassroomPathShell />);

    fireEvent.click(screen.getByRole('button', { name: 'Ir a reglas del grupo' }));

    expect(screen.getByRole('heading', { name: 'Reglas: Grupo de Ciencias' })).toBeInTheDocument();
    expect(screen.getByText('Rules Manager for Grupo de Ciencias')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/reglas');

    fireEvent.click(screen.getByRole('button', { name: 'Volver al grupo' }));

    expect(screen.getByRole('heading', { name: 'Grupos y Políticas' })).toBeInTheDocument();
    expect(screen.getByText('Groups View')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/politicas');
  });

  it('falls back to the dashboard when an unknown tab is requested', () => {
    render(<ClassroomPathShell />);

    fireEvent.click(screen.getByRole('button', { name: 'Tab inválida' }));

    expect(screen.getByRole('heading', { name: 'ClassroomPath' })).toBeInTheDocument();
    expect(screen.getByText('Dashboard View')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('falls back to the teacher dashboard when a non-admin reaches the users tab', () => {
    mockIsAdmin.mockReturnValue(false);

    render(<ClassroomPathShell />);

    expect(screen.getByRole('heading', { name: 'Mi Panel' })).toBeInTheDocument();
    expect(screen.getByText('Teacher Dashboard View')).toBeInTheDocument();
  });

  it('uses the teacher fallback when a non-admin reaches the domains tab', () => {
    mockIsAdmin.mockReturnValue(false);
    window.history.pushState({}, '', '/dominios');

    render(<ClassroomPathShell />);

    expect(screen.getByRole('heading', { name: 'Mi Panel' })).toBeInTheDocument();
    expect(screen.getByText('Teacher Dashboard View')).toBeInTheDocument();
  });
});
