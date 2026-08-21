/**
 * ClassroomPathShell -- authenticated application shell rendered inside ClassroomPathApp.
 *
 * Owns: the URL-based tab router (Routes/Navigate), Sidebar + Header layout sourced from
 * OpenPath via src/openpath/public-shell, and CP-only views (OrganizationUsers,
 * DomainRequestsPage, DomainRequestApprovalPage).  Routing helpers and title logic live in
 * src/app/classroom-path-shell-routing.ts and classroom-path-shell-state.ts respectively.
 * isAdmin() comes from src/openpath/public-auth.  The topBanner slot is injected by
 * ClassroomPathApp (BillingStatusBanner).  This module has no boot or auth responsibility --
 * all auth/onboarding gating is handled upstream in ClassroomPathApp via useClassroomPathBoot.
 */
import React, { useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import {
  Classrooms,
  Dashboard,
  Groups,
  Header,
  RulesManager,
  Settings,
  Sidebar,
  TeacherDashboard,
} from './openpath/public-shell';
import { isAdmin } from './openpath/public-auth';

import { GroupLibrary } from './components/GroupLibrary';
import WindowsOfflineInstallerAction from './components/WindowsOfflineInstallerAction';
import { PolicyLibraryButton } from './components/PolicyLibraryButton';
import { OrganizationUsers } from './views/OrganizationUsers';
import { DomainRequestsPage } from './views/DomainRequestsPage';
import { DomainRequestApprovalPage } from './views/DomainRequestApprovalPage';
import {
  getPathForTab,
  getTabFromPathname,
  normalizeShellPathname,
  type AppTab,
} from './app/classroom-path-shell-routing';
import { getShellTitle, type SelectedGroupState } from './app/classroom-path-shell-state';
import { useClassroomPathT } from './i18n/classroompath-i18n';

interface SelectedGroup extends SelectedGroupState {}

type ClassroomPathShellProps = {
  topBanner?: React.ReactNode;
  userRole?: string;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function ClassroomPathShellContent({ topBanner, userRole }: ClassroomPathShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = normalizeShellPathname(location.pathname);
  const activeTab = getTabFromPathname(pathname);
  const isClassroomsView = activeTab === 'classrooms';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup | null>(null);
  const [pendingSelectedClassroomId, setPendingSelectedClassroomId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const admin = isAdmin();
  const t = useClassroomPathT();

  const canUseLibrary = userRole === 'admin' || userRole === 'teacher';
  const libraryAction = canUseLibrary ? (
    <PolicyLibraryButton onClick={() => setLibraryOpen(true)} />
  ) : undefined;

  const classroomsHeaderAction =
    canUseLibrary && pendingSelectedClassroomId ? (
      <WindowsOfflineInstallerAction classroomId={pendingSelectedClassroomId} />
    ) : undefined;

  const shellClassName = cx(
    'flex min-h-screen bg-slate-50 font-sans text-slate-900',
    isClassroomsView ? 'lg:h-screen lg:overflow-hidden' : ''
  );

  const contentShellClassName = cx(
    'flex min-h-screen flex-1 flex-col transition-all duration-300',
    sidebarCollapsed ? 'md:ml-16' : 'md:ml-64',
    isClassroomsView ? 'lg:h-full lg:min-h-0 lg:overflow-hidden' : ''
  );

  const mainClassName = cx(
    'flex-1 p-6 md:p-8',
    isClassroomsView ? 'overflow-y-auto lg:min-h-0 lg:overflow-hidden' : 'overflow-y-auto'
  );

  const contentWrapperClassName = cx(
    'mx-auto max-w-7xl',
    isClassroomsView ? 'lg:h-full lg:min-h-0' : ''
  );

  const navigateToTab = (tab: AppTab) => {
    setPendingSelectedClassroomId(null);
    setSidebarOpen(false);
    navigate(getPathForTab(tab));
  };

  const handleNavigateToRules = (group: SelectedGroup) => {
    setSelectedGroup(group);
    navigate('/rules');
  };

  const handleBackFromRules = () => {
    setSelectedGroup(null);
    navigate('/policies');
  };

  const handleNavigateToClassroom = (classroom: { id: string; name: string }) => {
    setPendingSelectedClassroomId(classroom.id);
    navigate('/classrooms');
  };

  const handlePendingSelectedClassroomIdConsumed = () => {
    setPendingSelectedClassroomId(null);
  };

  const renderDashboard = () =>
    admin ? (
      <Dashboard
        onNavigateToRules={handleNavigateToRules}
        onNavigateToClassroom={handleNavigateToClassroom}
      />
    ) : (
      <TeacherDashboard onNavigateToRules={handleNavigateToRules} />
    );

  const renderTeacherFallback = () => (
    <TeacherDashboard onNavigateToRules={handleNavigateToRules} />
  );

  return (
    <div data-testid="classroompath-shell-root" className={shellClassName}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={(tab) => navigateToTab(tab as AppTab)}
        isOpen={sidebarOpen}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
        allowDomainRequestsForNonAdmins
      />

      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div data-testid="classroompath-shell-content" className={contentShellClassName}>
        <Header
          onMenuClick={() => setSidebarOpen((current) => !current)}
          title={getShellTitle({ activeTab, admin, selectedGroup, t })}
        />

        {topBanner ? (
          <div
            data-testid="classroompath-shell-banner"
            className="border-b border-slate-200 bg-white px-4 py-3 md:px-8"
          >
            <div className="mx-auto max-w-7xl">{topBanner}</div>
          </div>
        ) : null}

        <main data-testid="classroompath-shell-main" className={mainClassName}>
          <div
            data-testid="classroompath-shell-content-wrapper"
            className={contentWrapperClassName}
          >
            <Routes>
              <Route path="/" element={renderDashboard()} />
              <Route path="/dashboard" element={<Navigate replace to="/" />} />
              <Route
                path="/classrooms"
                element={
                  <Classrooms
                    initialSelectedClassroomId={pendingSelectedClassroomId}
                    onInitialSelectedClassroomIdConsumed={handlePendingSelectedClassroomIdConsumed}
                    headerActions={classroomsHeaderAction}
                  />
                }
              />
              <Route
                path="/policies"
                element={
                  <Groups onNavigateToRules={handleNavigateToRules} headerActions={libraryAction} />
                }
              />
              <Route
                path="/rules"
                element={
                  selectedGroup ? (
                    <RulesManager
                      groupId={selectedGroup.id}
                      groupName={selectedGroup.name}
                      readOnly={selectedGroup.readOnly}
                      onBack={handleBackFromRules}
                    />
                  ) : (
                    <Groups
                      onNavigateToRules={handleNavigateToRules}
                      headerActions={libraryAction}
                    />
                  )
                }
              />
              <Route
                path="/users"
                element={admin ? <OrganizationUsers /> : renderTeacherFallback()}
              />
              <Route
                path="/domain-requests/approve/:requestId"
                element={<DomainRequestApprovalPage />}
              />
              <Route path="/domain-requests" element={<DomainRequestsPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate replace to="/" />} />
            </Routes>
          </div>
        </main>
      </div>

      <GroupLibrary
        userRole={userRole}
        isOpen={libraryOpen}
        onClose={() => setLibraryOpen(false)}
      />
    </div>
  );
}

export default function ClassroomPathShell(props: ClassroomPathShellProps) {
  return <ClassroomPathShellContent topBanner={props.topBanner} userRole={props.userRole} />;
}
