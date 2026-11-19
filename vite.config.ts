/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { WEB_APP_MANIFEST } from './src/util/pwa.js';

// GitHub Pages serves the app from https://izzardry.github.io/spellplane/
export default defineConfig(({ mode }) => ({
  // The preview build (M7, .github/workflows/deploy.yml) is served beside the live site at /spellplane/preview/.
  base: process.env.SPELLPLANE_BASE ?? '/spellplane/',
  plugins: [
    svelte(),
    // Service worker (src/sw.ts) and web app manifest (PLAN M5-P3; util/pwa.ts): the worker precaches every file of
    // the build (the list is injected as `self.__WB_MANIFEST`) and serves card images cache-first. Built in production
    // and test builds; main.ts registers it in production, and in test builds only with `?sw=on` (the offline tests),
    // so no other browser test runs behind a worker. Dev builds run none. vite-plugin-pwa only builds sw.ts and
    // injects the file list; the worker has no Workbox runtime.
    VitePWA({
      disable: mode !== 'production' && mode !== 'test',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: { ...WEB_APP_MANIFEST, icons: WEB_APP_MANIFEST.icons.map((i) => ({ ...i })) },
      includeManifestIcons: true,
      injectManifest: {
        injectionPoint: 'self.__WB_MANIFEST',
        globPatterns: ['**/*.{html,js,css,ttf,woff2,png,svg,webmanifest}'],
        globIgnores: ['sw.js', '**/*.map'],
        // The main chunk is about 1 MB; the default limit (2 MB) would silently leave a grown one out of the precache.
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
      },
    }),
  ],
  define: {
    // The debug hook (window.__spellplane) ships in dev and test builds only.
    __SPELLPLANE_DEBUG__: JSON.stringify(mode !== 'production'),
    // The preview build: its own saved data, no service worker, a Preview label (M7 fast feedback, PLAN Milestone 7).
    __SPELLPLANE_PREVIEW__: JSON.stringify(process.env.SPELLPLANE_PREVIEW === '1'),
  },
  build: {
    target: 'es2023',
    sourcemap: true,
    outDir: mode === 'test' ? 'dist-test' : 'dist',
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/sim/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    // Locally, several agents run the suite at once in parallel worktrees: cap each run's workers so they
    // do not starve the machine (CI uses Vitest's default). SPELLPLANE_TEST_WORKERS overrides.
    ...(process.env.CI ? {} : { maxWorkers: Number(process.env.SPELLPLANE_TEST_WORKERS ?? 4) }),
  },
}));
