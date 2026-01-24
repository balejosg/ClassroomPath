import React, { useState, useEffect } from 'react';
import OpenPathApp from '@openpath/App';
import { isAuthenticated, onAuthChange } from '@openpath/lib/auth';
import { DualTRPCProvider } from './lib/dual-trpc-provider';
import { useOnboardingStatus } from './lib/hooks';
import { Register } from './views/Register';
import { Onboarding } from './views/Onboarding';
import { Waiting } from './views/Waiting';

// Componente que decide qué pantalla mostrar basado en el estado de autenticación y onboarding
function AppContent() {
  const [isAuth, setIsAuth] = useState(isAuthenticated());
  const [showRegister, setShowRegister] = useState(false);
  
  // Escuchar cambios de autenticación (ej: login exitoso)
  useEffect(() => {
    return onAuthChange(() => {
      setIsAuth(isAuthenticated());
    });
  }, []);

  const query = useOnboardingStatus({
    enabled: isAuth,
  });

  const { data: status, isLoading, refetch } = query;

  // 1. No autenticado -> Mostrar Login (de OpenPath) o Registro (de ClassroomPath)
  if (!isAuth) {
    if (showRegister) {
      return (
        <Register 
          onLoginClick={() => setShowRegister(false)} 
          onSuccess={() => {
            // Tras registro exitoso, el backend de CP NO auto-onboardea (Fase 0 aplicada)
            // El usuario debe loguearse (o si el registro devuelve tokens, setIsAuth(true))
            // En este sistema, el registro de OpenPath NO loguea automáticamente, 
            // pero el de ClassroomPath podría. Por ahora, forzamos login.
            setShowRegister(false);
          }}
        />
      );
    }
    
    // Aquí usamos la pantalla de Login de OpenPath, pero necesitamos una forma de
    // conmutar a nuestro Registro. Como OpenPathApp es una "caja negra" que maneja su propio
    // login, vamos a envolverla o interceptar el estado.
    // Si OpenPathApp detecta que no hay auth, mostrará su propio Login.
    // Añadiremos un pequeño "truco" visual o esperaremos a que el usuario se loguee.
    return (
      <div className="relative">
        <OpenPathApp />
        {/* Botón flotante para ir a Registro si estamos en la pantalla de login */}
        {!isAuth && (
          <div className="fixed bottom-4 right-4 z-50">
            <button 
              onClick={() => setShowRegister(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg hover:bg-blue-700 transition-colors cursor-pointer text-sm font-medium"
            >
              ¿No tienes cuenta? Regístrate
            </button>
          </div>
        )}
      </div>
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

  // 3. Usuario en espera de invitación
  if (status?.isWaiting) {
    return (
      <Waiting 
        onStatusChange={() => refetch()} 
        onCancelSuccess={() => refetch()} 
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
      />
    );
  }

  // 5. Usuario onboarded -> Mostrar aplicación principal
  return <OpenPathApp />;
}

export function ClassroomPathApp() {
  return (
    <DualTRPCProvider>
      <AppContent />
    </DualTRPCProvider>
  );
}
