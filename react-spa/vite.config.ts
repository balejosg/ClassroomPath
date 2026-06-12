/**
 * Vite build config for the ClassroomPath SPA wrapper.
 *
 * Wrapper architecture: the @openpath/public-* aliases (and @openpath/openpath.css) map
 * each OpenPath public entrypoint to its versioned file inside upstream/openpath/react-spa/src/public/.
 * ClassroomPath code must consume OpenPath functionality ONLY through these aliases or through
 * the src/openpath/ adapter layer that re-exports them -- deep imports into OpenPath internals
 * (anything not under src/public/) violate the wrapper contract and break the boundary enforced
 * by src/openpath/__tests__/adapter-boundary.test.ts.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // NOTE: Order matters. Keep the more-specific alias first so
      // subpath imports like "@openpath/shared/domain" don't get captured by "@openpath".
      '@openpath/openpath.css': path.resolve(
        __dirname,
        '../upstream/openpath/react-spa/src/index.css'
      ),
      '@openpath/public-auth': path.resolve(
        __dirname,
        '../upstream/openpath/react-spa/src/public/auth.ts'
      ),
      '@openpath/public-google': path.resolve(
        __dirname,
        '../upstream/openpath/react-spa/src/public/google.ts'
      ),
      '@openpath/public-i18n': path.resolve(
        __dirname,
        '../upstream/openpath/react-spa/src/public/i18n.ts'
      ),
      '@openpath/public-shell': path.resolve(
        __dirname,
        '../upstream/openpath/react-spa/src/public/shell.ts'
      ),
      '@openpath/public-ui': path.resolve(
        __dirname,
        '../upstream/openpath/react-spa/src/public/ui.ts'
      ),
      '@openpath/shared': path.resolve(__dirname, '../upstream/openpath/shared/src'),
      '@openpath': path.resolve(__dirname, '../upstream/openpath/react-spa'),
    },
  },
  server: {
    proxy: {
      '/trpc': process.env.OPENPATH_API_URL ?? 'http://localhost:3000',
      '/cp/trpc': process.env.CP_API_URL ?? 'http://localhost:3001',
    },
  },
});
