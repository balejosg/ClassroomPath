import React from 'react';
import { Check, X } from 'lucide-react';
import { validatePassword } from '../utils/validation';

interface Props {
  password: string;
}

export function PasswordStrength({ password }: Props) {
  if (!password) return null;

  const validation = validatePassword(password);

  const requirements = [
    { label: 'Al menos 8 caracteres', met: validation.length },
    { label: 'Una mayúscula', met: validation.hasUpper },
    { label: 'Una minúscula', met: validation.hasLower },
    { label: 'Un número', met: validation.hasDigit },
  ];

  const strength = [
    validation.length,
    validation.hasUpper,
    validation.hasLower,
    validation.hasDigit,
  ].filter(Boolean).length;

  const strengthColor =
    strength <= 1 ? 'bg-red-500' : strength <= 3 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div
      className="mt-2 space-y-2 password-strength-indicator"
      data-testid="password-strength"
      role="status"
      aria-live="polite"
      aria-label={`Fortaleza de contraseña: ${strength} de 4 requisitos cumplidos`}
    >
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${strengthColor}`}
          style={{ width: `${(strength / 4) * 100}%` }}
          role="progressbar"
          aria-valuenow={strength}
          aria-valuemin={0}
          aria-valuemax={4}
        />
      </div>
      <ul className="text-sm space-y-1">
        {requirements.map((req, i) => (
          <li
            key={i}
            className={`flex items-center gap-2 ${req.met ? 'text-green-600' : 'text-gray-500'}`}
          >
            {req.met ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
            <span>{req.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
