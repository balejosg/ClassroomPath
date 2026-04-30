import React from 'react';
import { BrowserRouter } from 'react-router-dom';

import { DualTRPCProvider } from './lib/dual-trpc-provider';
import { AdminPanel } from './components/AdminPanel';
import { GroupLibrary } from './components/GroupLibrary';
import { AuthEntryView } from './app/AuthEntryView';
import { OnboardingAccessGate } from './app/OnboardingAccessGate';
import { useClassroomPathBoot } from './app/use-classroom-path-boot';
import { BillingCancel } from './views/BillingCancel';
import { BillingSuccess } from './views/BillingSuccess';
import './index.css';

const ClassroomPathShell = React.lazy(() => import('./ClassroomPathShell'));

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
        <p className="font-medium text-gray-600">{label}</p>
      </div>
    </div>
  );
}

function AppContent() {
  const boot = useClassroomPathBoot();

  if (boot.screen === 'preparing') {
    return <FullScreenLoader label="Preparando ClassroomPath..." />;
  }

  if (boot.screen === 'auth') {
    return (
      <AuthEntryView
        authView={boot.effectiveAuthView}
        isAuthenticated={boot.isAuth}
        onAuthenticated={boot.onAuthenticated}
        onSetAuthView={boot.onSetAuthView}
      />
    );
  }

  if (boot.screen === 'billing-success') {
    return (
      <BillingSuccess onComplete={boot.onBillingSuccessComplete} onLogout={boot.onBillingLogout} />
    );
  }

  if (boot.screen === 'billing-cancel') {
    return <BillingCancel onBack={boot.onBillingCancelBack} onLogout={boot.onBillingLogout} />;
  }

  return (
    <OnboardingAccessGate
      status={boot.status}
      isLoading={boot.isLoading}
      loadingTimedOut={boot.loadingTimedOut}
      isError={boot.isError}
      isAcceptingPendingInvitation={boot.isAcceptingPendingInvitation}
      onRetry={boot.onRetryOnboardingStatus}
      onLogoutToLogin={boot.onLogoutToLogin}
      onAcceptPendingInvitation={boot.onAcceptPendingInvitation}
      onDismissPendingInvitation={boot.onDismissPendingInvitation}
      onStatusChange={boot.onStatusChange}
      onCancelWaitingSuccess={boot.onCancelWaitingSuccess}
      onOrgCreated={boot.onOrgCreated}
      authenticatedContent={
        <React.Suspense fallback={<FullScreenLoader label="Cargando tu panel..." />}>
          <AdminPanel userRole={boot.status?.organization?.role} />
          <GroupLibrary userRole={boot.status?.organization?.role} />
          <ClassroomPathShell />
        </React.Suspense>
      }
    />
  );
}

export function ClassroomPathApp() {
  return (
    <DualTRPCProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </DualTRPCProvider>
  );
}

export default ClassroomPathApp;
