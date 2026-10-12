import { defineConfig, devices } from '@playwright/test';

// Testes de tela: sobem o site já compilado (vite preview) e navegam
// pelas páginas principais com a API simulada (e2e/mock-api.mjs), no PC
// e no celular. Pegam tela branca, erro de JavaScript e layout vazando.
// PW_PORT troca a porta do preview (útil quando outra cópia do projeto já
// está usando a 4173 na mesma máquina).
const PORT = Number(process.env.PW_PORT || 4173);

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'pc', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: { PW_E2E: '1' },
  },
});
