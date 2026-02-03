import React, { useState } from 'react';
import { Button } from '@openpath/src/components/ui/Button';
import { Input } from '@openpath/src/components/ui/Input';
import { Card } from '@openpath/src/components/ui/Card';
import { PasswordStrength } from '../components/PasswordStrength';
import { validateEmail, validatePassword, ERROR_MESSAGES_ES } from '../utils/validation';
import { cpTrpcReact } from '../lib/dual-trpc-provider';

interface Props {
  onLoginClick: () => void;
  onSuccess: () => void;
}

export function Register({ onLoginClick, onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState('');

  const loginMutation = cpTrpcReact.auth.login.useMutation();

  const persistSession = (result: {
    accessToken: string;
    refreshToken: string;
    user: unknown;
  }) => {
    localStorage.setItem('openpath_access_token', result.accessToken);
    localStorage.setItem('openpath_refresh_token', result.refreshToken);
    localStorage.setItem('openpath_user', JSON.stringify(result.user));
  };
  
  const registerMutation = cpTrpcReact.auth.register.useMutation({
    onSuccess: async () => {
      // OpenPath register does not return tokens; do auto-login for better UX.
      try {
        const result = await loginMutation.mutateAsync({ email, password });
        persistSession(result);
        onSuccess();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : ERROR_MESSAGES_ES.loginFailed
        );
      }
    },
    onError: (err) => {
      setError(err.message || ERROR_MESSAGES_ES.registrationFailed);
    },
  });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Validaciones
    if (!validateEmail(email)) {
      setError(ERROR_MESSAGES_ES.invalidEmail);
      return;
    }
    
    const pwdValidation = validatePassword(password);
    if (!pwdValidation.isValid) {
      setError(ERROR_MESSAGES_ES.weakPassword);
      return;
    }
    
    if (password !== confirmPassword) {
      setError(ERROR_MESSAGES_ES.passwordMismatch);
      return;
    }
    
    if (!termsAccepted) {
      setError(ERROR_MESSAGES_ES.termsRequired);
      return;
    }
    
    registerMutation.mutate({ email, name, password });
  };

  const isBusy = registerMutation.isPending || loginMutation.isPending;
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md p-8">
        <h1 className="text-2xl font-bold mb-6 text-center">Crear Cuenta</h1>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Email</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.com"
            required
            disabled={isBusy}
          />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Nombre</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre completo"
            required
            disabled={isBusy}
          />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Contraseña</label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            disabled={isBusy}
          />
            <PasswordStrength password={password} />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Confirmar Contraseña</label>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            required
            disabled={isBusy}
          />
          </div>
          
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="terms"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              disabled={isBusy}
            />
            <label htmlFor="terms" className="text-sm text-gray-600">
              Acepto los{' '}
              <a href="/terms.html" target="_blank" className="text-blue-600 hover:underline">
                términos de servicio
              </a>
            </label>
          </div>
          
          <Button
            type="submit"
            className="w-full cursor-pointer"
            disabled={isBusy}
          >
            {isBusy ? 'Creando cuenta...' : 'Registrarse'}
          </Button>
        </form>
        
        <p className="mt-6 text-center text-sm text-gray-600">
          ¿Ya tienes cuenta?{' '}
          <button
            onClick={onLoginClick}
            className="text-blue-600 font-medium hover:underline cursor-pointer"
          >
            Inicia sesión
          </button>
        </p>
      </Card>
    </div>
  );
}
