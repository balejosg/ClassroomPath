import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@openpath': path.resolve(__dirname, '../upstream/openpath/react-spa'),
      '@openpath/shared': path.resolve(__dirname, '../upstream/openpath/shared/src'),
    },
  },
  server: {
    proxy: {
      '/trpc': 'http://localhost:3000',
      '/cp/trpc': 'http://localhost:3001',
    },
  },
});
