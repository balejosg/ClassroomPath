export function validateEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

export interface PasswordValidation {
  length: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasDigit: boolean;
  isValid: boolean;
}

export function validatePassword(password: string): PasswordValidation {
  const length = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);

  return {
    length,
    hasUpper,
    hasLower,
    hasDigit,
    isValid: length && hasUpper && hasLower && hasDigit,
  };
}

export const ERROR_MESSAGES_EN = {
  invalidEmail: 'Invalid email address',
  weakPassword:
    'Password must be at least 8 characters and include uppercase, lowercase, and numbers',
  passwordMismatch: 'Passwords do not match',
  termsRequired: 'You must accept the terms of service',
  registrationFailed: 'Could not create the account. Please try again.',
  loginFailed: 'Could not log in. Check your credentials.',
};

export const ERROR_MESSAGES_ES = {
  invalidEmail: 'Correo electrónico inválido',
  weakPassword:
    'La contraseña debe tener al menos 8 caracteres e incluir mayúsculas, minúsculas y números',
  passwordMismatch: 'Las contraseñas no coinciden',
  termsRequired: 'Debes aceptar los términos de servicio',
  registrationFailed: 'No se pudo crear la cuenta. Inténtalo de nuevo.',
  loginFailed: 'No se pudo iniciar sesión. Revisa tus credenciales.',
};
