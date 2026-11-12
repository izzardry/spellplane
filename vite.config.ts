/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from https://izzardry.github.io/spellplane/
export default defineConfig(({ mode }) => ({
  base: '/spellplane/',
  plugins: [
    svelte(),
    // Service worker (src/sw.ts): cache-first Scryfall card images (DESIGN "Card data and images", Caching).
    // Production builds only, so dev and test builds never run a worker; no precache and no web app manifest.
    VitePWA({
      disable: mode !== 'production',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: 'script',
      manifest: false,
      injectManifest: { injectionPoint: undefined },
    }),
  ],
  define: {
    // The debug hook (window.__spellplane) ships in dev and test builds only.
    __SPELLPLANE_DEBUG__: JSON.stringify(mode !== 'production'),
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
