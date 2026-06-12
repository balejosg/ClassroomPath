/**
 * Shared test environment constants and top-level env initialisation.
 *
 * Import this module FIRST (before any app/config imports) in test files that
 * need JWT_SECRET and NODE_ENV set before the application singleton loads.
 * The assignments below run at module evaluation time, preserving the
 * "env before import" ordering that singleton config readers require.
 */

export const TEST_JWT_SECRET = 'test-jwt-secret';

process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.NODE_ENV = 'test';
