import { defineConfig, mergeConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [tsconfigPaths()],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      // Important for monorepo/submodule resolution
      deps: {
        optimizer: {
          web: {
            include: [/@openpath/],
          },
        },
      },
    },
  })
);
