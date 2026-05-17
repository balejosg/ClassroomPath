import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

const mockIsAdmin = vi.fn();

vi.mock('../openpath/public-shell', () => ({
  Sidebar: ({
    setActiveTab,
  }: {
    activeTab: string;
    isOpen: boolean;
    setActiveTab: (tab: string) => void;
  }) => (
    <nav>
      <button onClick={() => setActiveTab('users')}>Users and Roles</button>
      <button onClick={() => setActiveTab('classrooms')}>Classrooms</button>
      <button onClick={() => setActiveTab('groups')}>Políticas</button>
      <button onClick={() => setActiveTab('domains')}>Domain Requests</button>
      <button onClick={() => setActiveTab('settings')}>Settings</button>
      <button onClick={() => setActiveTab('unknown')}>Tab inválida</button>
    </nav>
  ),
  Header: ({ title, onMenuClick }: { title: string; onMenuClick: () => void }) => (
    <header>
      <button onClick={onMenuClick}>Abrir menú</button>
      <h1>{title}</h1>
    </header>
  ),
  Dashboard: ({
    onNavigateToRules,
    onNavigateToClassroom,
  }: {
    onNavigateToRules: (group: { id: string; name: string; readOnly?: boolean }) => void;
    onNavigateToClassroom?: (classroom: { id: string; name: string }) => void;
  }) => (
    <div>
      <div>Dashboard View</div>
      <button onClick={() => onNavigateToRules({ id: 'grp-1', name: 'Grupo Demo' })}>
        Dashboard a reglas
      </button>
      <button onClick={() => onNavigateToClassroom?.({ id: 'classroom-1', name: 'Informática 3' })}>
        Dashboard a aula
      </button>
    </div>
  ),
  TeacherDashboard: ({
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
  Classrooms: ({
    initialSelectedClassroomId,
    onInitialSelectedClassroomIdConsumed,
  }: {
    initialSelectedClassroomId?: string | null;
    onInitialSelectedClassroomIdConsumed?: () => void;
  }) => (
    <div>
      <div>Classrooms View</div>
      <div>Initial classroom: {initialSelectedClassroomId ?? 'none'}</div>
      <button onClick={() => onInitialSelectedClassroomIdConsumed?.()}>
        Consumir selección inicial
      </button>
    </div>
  ),
  Groups: ({
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
  Settings: () => <div>Settings View</div>,
  DomainRequests: () => <div>Domain Requests View</div>,
  RulesManager: ({
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

vi.mock('../openpath/public-auth', () => ({
  isAdmin: () => mockIsAdmin(),
}));

vi.mock('../views/OrganizationUsers', () => ({
  OrganizationUsers: () => <div>Organization Users View</div>,
}));

vi.mock('../views/DomainRequestApprovalPage', () => ({
  DomainRequestApprovalPage: () => <div>Focused Approval View</div>,
}));

import ClassroomPathShell from '../ClassroomPathShell';

function renderShell() {
  return render(
    <BrowserRouter>
      <ClassroomPathShell />
    </BrowserRouter>
  );
}

describe('ClassroomPathShell', () => {
  beforeEach(() => {
    mockIsAdmin.mockReset();
    mockIsAdmin.mockReturnValue(true);
    window.history.pushState({}, '', '/users');
  });

  it('renders the ClassroomPath users view for admins on the users route', () => {
    renderShell();

    expect(screen.getByRole('heading', { name: 'User Administration' })).toBeInTheDocument();
    expect(screen.getByText('Organization Users View')).toBeInTheDocument();
  });

  it('updates the active route and title when navigating through the sidebar', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Settings View')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/settings');
  });

  it('reacts to browser history changes and renders admin canonical routes', async () => {
    window.history.pushState({}, '', '/policies');

    renderShell();

    expect(screen.getByRole('heading', { name: 'Groups and Policies' })).toBeInTheDocument();
    expect(screen.getByText('Groups View')).toBeInTheDocument();

    window.history.pushState({}, '', '/classrooms');
    fireEvent.popState(window);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Classroom Management' })).toBeInTheDocument();
    });
    expect(screen.getByText('Classrooms View')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Domain Requests' }));

    expect(screen.getByRole('heading', { name: 'Access Requests' })).toBeInTheDocument();
    expect(screen.getByText('Domain Requests View')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/domain-requests');
  });

  it('opens the mobile menu overlay and closes it when the overlay is clicked', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));

    const overlay = document.querySelector('.fixed.inset-0.z-30');
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay as Element);

    expect(document.querySelector('.fixed.inset-0.z-30')).toBeNull();
  });

  it('navigates to rules for a selected group and can return to the groups view', () => {
    window.history.pushState({}, '', '/policies');

    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Ir a reglas del grupo' }));

    expect(screen.getByRole('heading', { name: 'Rules: Grupo de Ciencias' })).toBeInTheDocument();
    expect(screen.getByText('Rules Manager for Grupo de Ciencias')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/rules');

    fireEvent.click(screen.getByRole('button', { name: 'Volver al grupo' }));

    expect(screen.getByRole('heading', { name: 'Groups and Policies' })).toBeInTheDocument();
    expect(screen.getByText('Groups View')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/policies');
  });

  it('navigates to classrooms for a selected classroom from the dashboard', () => {
    window.history.pushState({}, '', '/');

    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Dashboard a aula' }));

    expect(screen.getByRole('heading', { name: 'Classroom Management' })).toBeInTheDocument();
    expect(screen.getByText('Classrooms View')).toBeInTheDocument();
    expect(screen.getByText('Initial classroom: classroom-1')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/classrooms');

    fireEvent.click(screen.getByRole('button', { name: 'Consumir selección inicial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Users and Roles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Classrooms' }));

    expect(screen.getByText('Initial classroom: none')).toBeInTheDocument();
  });

  it('falls back to the dashboard when an unknown tab is requested', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Tab inválida' }));

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Dashboard View')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('falls back to the teacher dashboard when a non-admin reaches the users tab', () => {
    mockIsAdmin.mockReturnValue(false);

    renderShell();

    expect(screen.getByRole('heading', { name: 'My Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Teacher Dashboard View')).toBeInTheDocument();
  });

  it('renders domain requests when a non-admin teacher reaches the domains tab', () => {
    mockIsAdmin.mockReturnValue(false);
    window.history.pushState({}, '', '/domain-requests');

    renderShell();

    expect(screen.getByRole('heading', { name: 'Access Requests' })).toBeInTheDocument();
    expect(screen.getByText('Domain Requests View')).toBeInTheDocument();
  });

  it('renders the focused notification approval route before the general requests page', () => {
    mockIsAdmin.mockReturnValue(false);
    window.history.pushState({}, '', '/domain-requests/approve/req_123');

    renderShell();

    expect(screen.getByRole('heading', { name: 'Access Requests' })).toBeInTheDocument();
    expect(screen.getByText('Focused Approval View')).toBeInTheDocument();
    expect(screen.queryByText('Domain Requests View')).not.toBeInTheDocument();
  });
});
