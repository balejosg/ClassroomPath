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

interface SelectedGroup extends SelectedGroupState {}

function ClassroomPathShellContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = normalizeShellPathname(location.pathname);
  const activeTab = getTabFromPathname(pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup | null>(null);
  const [pendingSelectedClassroomId, setPendingSelectedClassroomId] = useState<string | null>(null);
  const admin = isAdmin();

  const navigateToTab = (tab: AppTab) => {
    setPendingSelectedClassroomId(null);
    setSidebarOpen(false);
    navigate(getPathForTab(tab));
  };

  const handleNavigateToRules = (group: SelectedGroup) => {
    setSelectedGroup(group);
    navigate('/reglas');
  };

  const handleBackFromRules = () => {
    setSelectedGroup(null);
    navigate('/politicas');
  };

  const handleNavigateToClassroom = (classroom: { id: string; name: string }) => {
    setPendingSelectedClassroomId(classroom.id);
    navigate('/aulas');
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
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={(tab) => navigateToTab(tab as AppTab)}
        isOpen={sidebarOpen}
        allowDomainRequestsForNonAdmins
      />

      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className="flex min-h-screen flex-1 flex-col md:ml-64">
        <Header
          onMenuClick={() => setSidebarOpen((current) => !current)}
          title={getShellTitle({ activeTab, admin, selectedGroup })}
        />

        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="mx-auto max-w-7xl">
            <Routes>
              <Route path="/" element={renderDashboard()} />
              <Route path="/dashboard" element={<Navigate replace to="/" />} />
              <Route
                path="/aulas"
                element={
                  <Classrooms
                    initialSelectedClassroomId={pendingSelectedClassroomId}
                    onInitialSelectedClassroomIdConsumed={handlePendingSelectedClassroomIdConsumed}
                  />
                }
              />
              <Route
                path="/politicas"
                element={<Groups onNavigateToRules={handleNavigateToRules} />}
              />
              <Route path="/grupos" element={<Navigate replace to="/politicas" />} />
              <Route
                path="/reglas"
                element={
                  selectedGroup ? (
                    <RulesManager
                      groupId={selectedGroup.id}
                      groupName={selectedGroup.name}
                      readOnly={selectedGroup.readOnly}
                      onBack={handleBackFromRules}
                    />
                  ) : (
                    <Groups onNavigateToRules={handleNavigateToRules} />
                  )
                }
              />
              <Route
                path="/usuarios"
                element={admin ? <OrganizationUsers /> : renderTeacherFallback()}
              />
              <Route path="/dominios/aprobar/:requestId" element={<DomainRequestApprovalPage />} />
              <Route path="/dominios" element={<DomainRequestsPage />} />
              <Route path="/configuracion" element={<Settings />} />
              <Route path="/settings" element={<Navigate replace to="/configuracion" />} />
              <Route path="*" element={<Navigate replace to="/" />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function ClassroomPathShell() {
  return <ClassroomPathShellContent />;
}
