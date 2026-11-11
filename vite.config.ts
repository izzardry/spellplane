/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// GitHub Pages serves the app from https://izzardry.github.io/spellplane/
export default defineConfig(({ mode }) => ({
  base: '/spellplane/',
  plugins: [svelte()],
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
  },
}));
