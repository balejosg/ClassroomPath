/**
 * Builds a sharded regression plan that maps test suite names to the files they should run, replacing a monolith plan.
 *
 * Invoked by: Imported by `scripts/run-ci-regression.mjs`; tested by `regression-plan-layout.test.ts`.
 * Usage: (library module, not invoked directly)
 */
export { REGRESSION_PLAN_DEFINITIONS, resolveRegressionPlan } from './verification-catalog.mjs';
