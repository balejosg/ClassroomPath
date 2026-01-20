import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

export default defineConfig({
    root: '.',
    build: {
        outDir: resolve(__dirname, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: 'index.html',
                sw: resolve(__dirname, '../upstream/openpath/spa/sw.ts'),
            },
            output: {
                // Service worker needs a fixed name at root, not hashed
                entryFileNames: (chunkInfo) => {
                    if (chunkInfo.name === 'sw') {
                        return 'sw.js';
                    }
                    return 'assets/[name]-[hash].js';
                },
            },
        },
    },
    resolve: {
        alias: [
            {
                find: '@',
                replacement: resolve(__dirname, '../upstream/openpath/spa/src'),
            },
            {
                find: '@openpath/shared',
                replacement: resolve(__dirname, '../upstream/openpath/shared/src/index.ts'),
            },
            {
                find: '@trpc/client',
                replacement: resolve(__dirname, 'node_modules/@trpc/client'),
            },
            // Redirect OpenPath trpc client to ClassroomPath client
            {
                find: /\.\.\/trpc\.js$/,
                replacement: resolve(__dirname, 'src/cp-trpc-compat.ts'),
            },
            // CSS Alias
            {
                find: '@openpath-css',
                replacement: resolve(__dirname, '../upstream/openpath/spa/css'),
            },
        ],
    },
    plugins: [
        // No plugins needed, we use explicit imports and local index.html
    ],
});
