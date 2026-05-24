import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@openpath/public-shell', () => ({
  Classrooms: () => <div>Classrooms</div>,
  Dashboard: () => <div>Dashboard</div>,
  DomainRequests: () => <div>DomainRequests</div>,
  Groups: () => <div>Groups</div>,
  Header: ({ title }: { title: string }) => <h1>{title}</h1>,
  RulesManager: () => <div>RulesManager</div>,
  Settings: () => <div>Settings</div>,
  Sidebar: () => <nav>Sidebar</nav>,
  TeacherDashboard: () => <div>TeacherDashboard</div>,
}));

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
} from '../public-shell';

describe('openpath public-shell adapter', () => {
  it('re-exports shell components through the local boundary', () => {
    render(
      <div>
        <Sidebar activeTab="dashboard" setActiveTab={() => {}} isOpen={false} />
        <Header title="Panel" onMenuClick={() => {}} />
        <Dashboard onNavigateToRules={() => {}} onNavigateToClassroom={() => {}} />
        <TeacherDashboard onNavigateToRules={() => {}} />
        <Classrooms />
        <Groups onNavigateToRules={() => {}} />
        <RulesManager groupId="group-1" groupName="Group 1" onBack={() => {}} />
        <DomainRequests />
        <Settings />
      </div>
    );

    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Panel' })).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('TeacherDashboard')).toBeInTheDocument();
    expect(screen.getByText('Classrooms')).toBeInTheDocument();
    expect(screen.getByText('Groups')).toBeInTheDocument();
    expect(screen.getByText('RulesManager')).toBeInTheDocument();
    expect(screen.getByText('DomainRequests')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});
