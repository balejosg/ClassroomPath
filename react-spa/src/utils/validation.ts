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

export const ERROR_MESSAGES_ES = {
  invalidEmail: 'Correo electrónico inválido',
  weakPassword: 'La contraseña debe tener al menos 8 caracteres, incluyendo mayúsculas, minúsculas y números',
  passwordMismatch: 'Las contraseñas no coinciden',
  termsRequired: 'Debes aceptar los términos de servicio',
  registrationFailed: 'Error al registrar usuario. Por favor intenta nuevamente.',
  loginFailed: 'No se pudo iniciar sesión. Verifica tus credenciales.',
};
