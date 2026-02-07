import React, { useState, useEffect } from 'react';

// Lazy load OpenPathApp so that localStorage.requests_api_url is set BEFORE
// the module is imported (which evaluates tRPC client URL at import time)
const OpenPathApp = React.lazy(() => import('@openpath/src/App'));
import { isAuthenticated, onAuthChange } from '@openpath/src/lib/auth';
import { DualTRPCProvider } from './lib/dual-trpc-provider';
import { useOnboardingStatus } from './lib/hooks';
import { Login } from './views/Login';
import { Register } from './views/Register';
import { Onboarding } from './views/Onboarding';
import { Waiting } from './views/Waiting';
import { AdminPanel } from './components/AdminPanel';
import './index.css';

// Componente que decide qué pantalla mostrar basado en el estado de autenticación y onboarding
function AppContent() {
  const [isAuth, setIsAuth] = useState(isAuthenticated());
  const [showRegister, setShowRegister] = useState(false);

  const clearSessionAndShowLogin = () => {
    localStorage.removeItem('openpath_access_token');
    localStorage.removeItem('openpath_refresh_token');
    localStorage.removeItem('openpath_user');
    setShowRegister(false);
    setIsAuth(false);
  };

  // Configure OpenPath SPA to use ClassroomPath's tenant-scoped tRPC endpoint
  // This MUST be before any conditional returns to follow React hooks rules
  useEffect(() => {
    localStorage.setItem('requests_api_url', '/cp');
    return () => {
      localStorage.removeItem('requests_api_url');
    };
  }, []);

  // Escuchar cambios de autenticación (ej: login exitoso)
  useEffect(() => {
    return onAuthChange(() => {
      setIsAuth(isAuthenticated());
    });
  }, []);

  const query = useOnboardingStatus({
    enabled: isAuth,
  });

  const { data: status, isLoading, refetch, isError, error } = query;

  // If localStorage has a stale/invalid token, isAuthenticated() will be true,
  // but protected queries will fail. In that case, clear the session and show Login.
  useEffect(() => {
    if (!isAuth || !isError || !error) return;

    // tRPC React Query wraps errors; check multiple possible locations
    const trpcError = error as any;
    const code = trpcError?.data?.code || trpcError?.shape?.data?.code;
    const message = trpcError?.message || '';
    const isUnauthorized =
      code === 'UNAUTHORIZED' ||
      message.toLowerCase().includes('not authenticated') ||
      message.toLowerCase().includes('unauthorized');

    if (isUnauthorized) {
      localStorage.removeItem('openpath_access_token');
      localStorage.removeItem('openpath_refresh_token');
      localStorage.removeItem('openpath_user');
      setIsAuth(false);
    }
  }, [isAuth, isError, error]);

  // 1. No autenticado -> Mostrar Login (de OpenPath) o Registro (de ClassroomPath)
  if (!isAuth) {
    if (showRegister) {
      return (
        <Register
          onLoginClick={() => setShowRegister(false)}
          onSuccess={() => {
            // Register now auto-logins (tokens stored) - continue into onboarding flow.
            setShowRegister(false);
            setIsAuth(true);
          }}
        />
      );
    }

    return (
      <Login onLogin={() => setIsAuth(true)} onNavigateToRegister={() => setShowRegister(true)} />
    );
  }

  // 2. Cargando estado de onboarding
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Verificando estado...</p>
        </div>
      </div>
    );
  }

  // If onboarding status fails for non-auth reasons, don't drop the user into onboarding.
  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">No se pudo verificar tu acceso</h2>
          <p className="text-sm text-slate-600 mt-2">
            Reintenta en unos segundos. Si el problema persiste, vuelve a iniciar sesion.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => refetch()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              Reintentar
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('openpath_access_token');
                localStorage.removeItem('openpath_refresh_token');
                localStorage.removeItem('openpath_user');
                setIsAuth(false);
              }}
              className="px-4 py-2 rounded-lg bg-slate-100 text-slate-800 font-medium hover:bg-slate-200"
            >
              Volver a login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Usuario en espera de invitación
  if (status?.isWaiting) {
    return (
      <Waiting
        onStatusChange={() => refetch()}
        onCancelSuccess={() => refetch()}
        onLogout={clearSessionAndShowLogin}
      />
    );
  }

  // 4. Usuario necesita crear organización o esperar invitación
  if (!status?.hasMembership) {
    return (
      <Onboarding
        onOrgCreated={(data) => {
          // Actualizar tokens y recargar para que OpenPathApp los tome
          localStorage.setItem('openpath_access_token', data.accessToken);
          localStorage.setItem('openpath_refresh_token', data.refreshToken);
          refetch();
        }}
        onWaitClick={() => refetch()}
        onLogout={clearSessionAndShowLogin}
      />
    );
  }

  // 5. Usuario onboarded -> Mostrar aplicación principal
  return (
    <React.Suspense
      fallback={<div className="flex justify-center items-center h-screen">Cargando...</div>}
    >
      <AdminPanel userRole={status?.organization?.role} />
      <OpenPathApp />
    </React.Suspense>
  );
}

export function ClassroomPathApp() {
  return (
    <DualTRPCProvider>
      <AppContent />
    </DualTRPCProvider>
  );
}
