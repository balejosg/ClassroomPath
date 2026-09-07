/**
 * Deprecation shim for retired production-promotion npm aliases.
 *
 * Invoked by: `npm run promote:production`, `npm run promote:production:full`,
 * and `npm run release:production` (all deprecated, no-op).
 * Usage: node scripts/deprecated-promotion-alias.mjs <deprecated-alias>
 *
 * Prints a pointer to the canonical promotion pair and exits 2 WITHOUT
 * performing any promotion action. The underlying scripts stay in place for
 * the canonical entry points (`release:promote`, `promote:current-staging`).
 */

const INTERNAL_REPLACEMENTS = new Map([
  ['promote:production', 'npm run release:promote -- --rc-run-id <RC_RUN_ID> --auto-tag --execute'],
  [
    'promote:production:full',
    'npm run release:promote -- --rc-run-id <RC_RUN_ID> --auto-tag --execute',
  ],
  ['release:production', 'npm run release:promote -- --rc-run-id <RC_RUN_ID> --auto-tag --execute'],
]);

const alias = process.argv[2] ?? '';
const internalReplacement = INTERNAL_REPLACEMENTS.get(alias);

const lines = [
  `DEPRECATED: \`npm run ${alias || '(unknown alias)'}\` is retired and performs NO action.`,
  '',
  'Canonical production-promotion entry points:',
  '  npm run release:promote -- --rc-run-id <RC_RUN_ID> --auto-tag --dry-run',
  '  npm run promote:current-staging   # compatibility wrapper; delegates the exact staging RC',
];

if (internalReplacement) {
  lines.push('', `Internal (non-alias) equivalent, for maintainers only: ${internalReplacement}`);
}

process.stderr.write(`${lines.join('\n')}\n`);
process.exit(2);
