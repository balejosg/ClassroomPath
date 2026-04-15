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

import { Dashboard, Header, Sidebar } from '../public-shell';

describe('openpath public-shell adapter', () => {
  it('re-exports shell components through the local boundary', () => {
    render(
      <div>
        <Sidebar activeTab="dashboard" setActiveTab={() => {}} isOpen={false} />
        <Header title="Panel" onMenuClick={() => {}} />
        <Dashboard onNavigateToRules={() => {}} onNavigateToClassroom={() => {}} />
      </div>
    );

    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Panel' })).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
