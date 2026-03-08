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
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: ['node_modules/**', 'src/test/**', '**/*.d.ts', '**/*.config.*', '**/types/**'],
        thresholds: {
          statements: 80,
          lines: 80,
          functions: 70,
          branches: 60,
        },
      },
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
