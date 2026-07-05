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
  ['promote:production', 'bash scripts/tag-production-release.sh <tag>'],
  ['promote:production:full', 'npm run release:promote -- --auto-tag --execute'],
  ['release:production', 'bash scripts/tag-production-release.sh <tag>'],
]);

const alias = process.argv[2] ?? '';
const internalReplacement = INTERNAL_REPLACEMENTS.get(alias);

const lines = [
  `DEPRECATED: \`npm run ${alias || '(unknown alias)'}\` is retired and performs NO action.`,
  '',
  'Canonical production-promotion entry points:',
  '  npm run release:promote           # inspect: prints the promotion plan (dry-run by default)',
  '  npm run promote:current-staging   # execute: tags and pushes the current staging candidate',
];

if (internalReplacement) {
  lines.push('', `Internal (non-alias) equivalent, for maintainers only: ${internalReplacement}`);
}

process.stderr.write(`${lines.join('\n')}\n`);
process.exit(2);
