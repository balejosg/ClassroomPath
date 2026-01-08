import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

function replaceAppCorePlugin(): Plugin {
    const cpInitPath = resolve(__dirname, 'src/cp-init.ts');
    const openpathSrcMain = resolve(__dirname, '../upstream/openpath/spa/src/main.ts');
    const realAppCorePath = resolve(__dirname, '../upstream/openpath/spa/src/modules/app-core.ts');
    return {
        name: 'replace-app-core',
        enforce: 'pre',
        resolveId(source, importer) {
            if (source.endsWith('/modules/app-core.js') || source === './modules/app-core.js') {
                if (importer && importer.endsWith('cp-init.ts')) {
                    return realAppCorePath;
                }
                return cpInitPath;
            }
            if (source === 'dist/main.js' || source.endsWith('/dist/main.js')) {
                return openpathSrcMain;
            }
            return null;
        }
    };
}

export default defineConfig({
    root: '../upstream/openpath/spa',
    build: {
        outDir: resolve(__dirname, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, '../upstream/openpath/spa/index.html'),
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
        replaceAppCorePlugin(),
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
