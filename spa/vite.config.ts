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
                
                let processedHtml = html.replace(
                    '<script type="module" src="dist/main.js"></script>',
                    '<script type="module" src="/src/main.ts"></script>'
                );

                return processedHtml.replace('</body>', `${onboardingHtml}\n</body>`);
            },
        },
    ],
});
