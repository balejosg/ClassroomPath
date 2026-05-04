import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CLASSROOMPATH_BRAND_ASSETS } from '../brand-assets';

const publicDir = resolve(__dirname, '../../public');

function publicFile(publicPath: string): string {
  return resolve(publicDir, publicPath.replace(/^\//, ''));
}

function readPngSize(publicPath: string): { width: number; height: number } {
  const buffer = readFileSync(publicFile(publicPath));
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

describe('ClassroomPath brand assets', () => {
  it('keeps the planned public assets available under /brand', () => {
    for (const assetPath of Object.values(CLASSROOMPATH_BRAND_ASSETS)) {
      expect(statSync(publicFile(assetPath)).size).toBeGreaterThan(800);
    }

    expect(readFileSync(publicFile(CLASSROOMPATH_BRAND_ASSETS.logoMark), 'utf8')).toContain('<svg');
    expect(readFileSync(publicFile(CLASSROOMPATH_BRAND_ASSETS.logoHorizontal), 'utf8')).toContain(
      'ClassroomPath'
    );
  });

  it('renders generated PNG assets at their planned dimensions', () => {
    expect(readPngSize(CLASSROOMPATH_BRAND_ASSETS.favicon)).toEqual({
      width: 512,
      height: 512,
    });
    expect(readPngSize(CLASSROOMPATH_BRAND_ASSETS.authHero)).toEqual({
      width: 1600,
      height: 1200,
    });
    expect(readPngSize(CLASSROOMPATH_BRAND_ASSETS.onboardingGovernance)).toEqual({
      width: 1600,
      height: 1000,
    });
    expect(readPngSize(CLASSROOMPATH_BRAND_ASSETS.waitingRoom)).toEqual({
      width: 1200,
      height: 900,
    });
    expect(readPngSize(CLASSROOMPATH_BRAND_ASSETS.ogCover)).toEqual({
      width: 1200,
      height: 630,
    });
  });

  it('wires favicon, app icon, and social cover metadata to the brand assets', () => {
    const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    const manifest = JSON.parse(
      readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8')
    ) as {
      icons: Array<{ src: string; sizes: string; type: string }>;
    };

    expect(indexHtml).toContain(`href="${CLASSROOMPATH_BRAND_ASSETS.logoMark}"`);
    expect(indexHtml).toContain(`href="${CLASSROOMPATH_BRAND_ASSETS.favicon}"`);
    expect(indexHtml).toContain(`content="${CLASSROOMPATH_BRAND_ASSETS.ogCover}"`);
    expect(manifest.icons).toContainEqual({
      src: CLASSROOMPATH_BRAND_ASSETS.favicon,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any maskable',
    });
  });
});
