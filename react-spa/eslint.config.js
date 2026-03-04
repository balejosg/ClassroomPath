import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      // App code should use centralized error reporting.
      'no-console': 'error',
    },
  },
  {
    files: ['src/lib/reportError.ts'],
    rules: {
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
];
