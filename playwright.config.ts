import { defineConfig } from '@playwright/test';

export default defineConfig({
  webServer: {
    command: 'cd spa && npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  use: {
    baseURL: 'http://localhost:5173',
  },
});
