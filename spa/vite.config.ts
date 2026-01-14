import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

export default defineConfig({
    build: {
        outDir: resolve(__dirname, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
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
        ],
    },
    root: resolve(__dirname),
    publicDir: resolve(__dirname, '../upstream/openpath/spa/css'),
    plugins: [
        {
            name: 'inject-classroompath-assets',
            transformIndexHtml(html) {
                const onboardingHtml = readFileSync(
                    resolve(__dirname, 'onboarding-screens.html'),
                    'utf-8'
                );
                const registerHtml = readFileSync(
                    resolve(__dirname, 'register-screen.html'),
                    'utf-8'
                );
                const cpCss = readFileSync(
                    resolve(__dirname, 'src/styles/onboarding.css'),
                    'utf-8'
                );
                const cssTag = `<style>${cpCss}</style>`;
                html = html.replace('</head>', `${cssTag}\n</head>`);
                html = html.replace('</body>', `${onboardingHtml}\n${registerHtml}\n</body>`);
                return html;
            },
        },
    ],
});
