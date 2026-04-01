import React, { useEffect, useState } from 'react';

import {
  Classrooms,
  Dashboard,
  DomainRequests,
  Groups,
  Header,
  RulesManager,
  Settings,
  Sidebar,
  TeacherDashboard,
} from '@openpath/public-shell';
import { isAdmin } from '@openpath/public-auth';

import { OrganizationUsers } from './views/OrganizationUsers';

type AppTab = 'dashboard' | 'classrooms' | 'groups' | 'rules' | 'users' | 'domains' | 'settings';

interface SelectedGroup {
  id: string;
  name: string;
  readOnly?: boolean;
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

function getTabFromPathname(pathname: string): AppTab {
  const normalized = normalizePathname(pathname);

  if (normalized === '/' || normalized.startsWith('/dashboard')) return 'dashboard';
  if (normalized.startsWith('/aulas')) return 'classrooms';
  if (normalized.startsWith('/politicas') || normalized.startsWith('/grupos')) return 'groups';
  if (normalized.startsWith('/reglas')) return 'rules';
  if (normalized.startsWith('/usuarios')) return 'users';
  if (normalized.startsWith('/dominios')) return 'domains';
  if (normalized.startsWith('/configuracion') || normalized.startsWith('/settings'))
    return 'settings';

  return 'dashboard';
}

function getPathForTab(tab: AppTab): string {
  switch (tab) {
    case 'dashboard':
      return '/';
    case 'classrooms':
      return '/aulas';
    case 'groups':
      return '/politicas';
    case 'rules':
      return '/reglas';
    case 'users':
      return '/usuarios';
    case 'domains':
      return '/dominios';
    case 'settings':
      return '/configuracion';
    default:
      return '/';
  }
}

export default function ClassroomPathShell() {
  const initialPathname = typeof window !== 'undefined' ? window.location.pathname : '/';

  const [activeTab, setActiveTab] = useState<AppTab>(() => getTabFromPathname(initialPathname));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup | null>(null);
  const [pendingSelectedClassroomId, setPendingSelectedClassroomId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      setActiveTab(getTabFromPathname(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const nextPath = getPathForTab(activeTab);
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath);
    }
  }, [activeTab]);

  const admin = isAdmin();

  const handleNavigateToRules = (group: SelectedGroup) => {
    setSelectedGroup(group);
    setActiveTab('rules');
  };

  const handleBackFromRules = () => {
    setSelectedGroup(null);
    setActiveTab('groups');
  };

  const handleNavigateToClassroom = (classroom: { id: string; name: string }) => {
    setPendingSelectedClassroomId(classroom.id);
    setActiveTab('classrooms');
  };

  const handlePendingSelectedClassroomIdConsumed = () => {
    setPendingSelectedClassroomId(null);
  };

  const handleSidebarTabChange = (tab: string) => {
    setPendingSelectedClassroomId(null);
    setActiveTab(tab as AppTab);
    setSidebarOpen(false);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return admin ? (
          <Dashboard
            onNavigateToRules={handleNavigateToRules}
            onNavigateToClassroom={handleNavigateToClassroom}
          />
        ) : (
          <TeacherDashboard onNavigateToRules={handleNavigateToRules} />
        );
      case 'classrooms':
        return (
          <Classrooms
            initialSelectedClassroomId={pendingSelectedClassroomId}
            onInitialSelectedClassroomIdConsumed={handlePendingSelectedClassroomIdConsumed}
          />
        );
      case 'groups':
        return <Groups onNavigateToRules={handleNavigateToRules} />;
      case 'rules':
        return selectedGroup ? (
          <RulesManager
            groupId={selectedGroup.id}
            groupName={selectedGroup.name}
            readOnly={selectedGroup.readOnly}
            onBack={handleBackFromRules}
          />
        ) : (
          <Groups onNavigateToRules={handleNavigateToRules} />
        );
      case 'users':
        return admin ? (
          <OrganizationUsers />
        ) : (
          <TeacherDashboard onNavigateToRules={handleNavigateToRules} />
        );
      case 'domains':
        return admin ? (
          <DomainRequests />
        ) : (
          <TeacherDashboard onNavigateToRules={handleNavigateToRules} />
        );
      case 'settings':
        return <Settings />;
      default:
        return admin ? (
          <Dashboard
            onNavigateToRules={handleNavigateToRules}
            onNavigateToClassroom={handleNavigateToClassroom}
          />
        ) : (
          <TeacherDashboard onNavigateToRules={handleNavigateToRules} />
        );
    }
  };

  const getTitle = () => {
    switch (activeTab) {
      case 'dashboard':
        return admin ? 'Vista General' : 'Mi Panel';
      case 'classrooms':
        return admin ? 'Gestión de Aulas' : 'Aulas';
      case 'groups':
        return admin ? 'Grupos y Políticas' : 'Mis Políticas';
      case 'rules':
        return selectedGroup ? `Reglas: ${selectedGroup.name}` : 'Gestión de Reglas';
      case 'users':
        return admin ? 'Administración de Usuarios' : 'Mi Panel';
      case 'domains':
        return admin ? 'Solicitudes de Acceso' : 'Mi Panel';
      case 'settings':
        return 'Configuración';
      default:
        return 'ClassroomPath';
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      <Sidebar activeTab={activeTab} setActiveTab={handleSidebarTabChange} isOpen={sidebarOpen} />

      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className="flex min-h-screen flex-1 flex-col md:ml-64">
        <Header onMenuClick={() => setSidebarOpen((current) => !current)} title={getTitle()} />

        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="mx-auto max-w-7xl">{renderContent()}</div>
        </main>
      </div>
    </div>
  );
}
