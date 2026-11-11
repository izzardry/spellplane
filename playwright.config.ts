import { defineConfig, devices } from '@playwright/test';

// Each git worktree gets its own port (derived from its path), so parallel agents never
// test another worktree's build. PW_PORT overrides.
function worktreePort(): number {
  let h = 0;
  for (const ch of process.cwd()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 4200 + (h % 700);
}
const PORT = Number(process.env.PW_PORT ?? (process.env.CI ? 4173 : worktreePort()));
export const BASE_URL = `http://localhost:${PORT}/spellplane/`;

// e2e runs against a test-mode production build (debug hook included, no network).
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // a flaky test is a failing test
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--use-gl=angle',
            '--enable-unsafe-swiftshader',
          ],
        },
        permissions: ['microphone'],
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `pnpm exec vite build --mode test && pnpm exec vite preview --mode test --outDir dist-test --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
