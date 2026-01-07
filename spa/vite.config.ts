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
        alias: {
            // Override OpenPath's app-core with our wrapper
            '@openpath/app-core': resolve(__dirname, 'src/cp-init.ts'),
        },
    },
    plugins: [
        // Plugin to inject onboarding screens into index.html
        {
            name: 'inject-onboarding-html',
            transformIndexHtml(html) {
                const onboardingHtml = readFileSync(
                    resolve(__dirname, 'onboarding-screens.html'),
                    'utf-8'
                );
                // Insert before closing </body>
                return html.replace('</body>', `${onboardingHtml}\n</body>`);
            },
        },
    ],
});
