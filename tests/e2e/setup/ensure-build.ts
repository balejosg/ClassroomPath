import { ensureBuildFresh } from './build-artifacts.js';

const targetId = process.argv[2];

if (targetId !== 'openpath-api' && targetId !== 'gateway') {
  throw new Error(
    'Usage: node --import tsx tests/e2e/setup/ensure-build.ts <openpath-api|gateway>'
  );
}

const { built } = ensureBuildFresh(targetId);
console.log(`[E2E] ${built ? 'Rebuilt' : 'Using fresh build'} for ${targetId}`);
