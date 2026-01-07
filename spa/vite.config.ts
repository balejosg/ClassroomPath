import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

export default defineConfig({
    root: '../upstream/openpath/spa',
    build: {
        outDir: resolve(__dirname, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, '../upstream/openpath/spa/index.html'),
            },
        },
    },
    resolve: {
        alias: [
            {
                find: './modules/app-core.js',
                replacement: resolve(__dirname, 'src/cp-init.ts'),
            },
            {
                find: '@openpath/shared',
                replacement: resolve(__dirname, '../upstream/openpath/shared/src/index.ts'),
            },
            {
                find: '@trpc/client',
                replacement: resolve(__dirname, 'node_modules/@trpc/client'),
            }
        ],
    },
    plugins: [
        {
            name: 'inject-onboarding-html',
            transformIndexHtml(html) {
                const onboardingHtml = readFileSync(
                    resolve(__dirname, 'onboarding-screens.html'),
                    'utf-8'
                );
                return html.replace('</body>', `${onboardingHtml}\n</body>`);
            },
        },
    ],
});
