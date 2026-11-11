import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import svelteConfig from './svelte.config.js';

// Module boundaries (docs/PLAN.md "Conventions"):
//   ui -> scene -> core, net -> core, draft -> core, data -> core.
// core imports nothing from the DOM, Three.js, Svelte or the network.
const ELEMENTS = [
  { type: 'core', pattern: 'src/core' },
  { type: 'net', pattern: 'src/net' },
  { type: 'store', pattern: 'src/store' },
  { type: 'data', pattern: 'src/data' },
  { type: 'draft', pattern: 'src/draft' },
  { type: 'scene', pattern: 'src/scene' },
  { type: 'themes', pattern: 'src/themes' },
  { type: 'ui', pattern: 'src/ui' },
  { type: 'voice', pattern: 'src/voice' },
  { type: 'games', pattern: 'src/games' },
  { type: 'debug', pattern: 'src/debug' },
  { type: 'util', pattern: 'src/util' },
];

const allow = (from, to) => ({ from: { element: { type: from } }, allow: { to: { element: { types: to } } } });

const POLICIES = [
  allow('util', ['util']),
  allow('core', ['core', 'util']),
  allow('games', ['games', 'core', 'util']),
  allow('net', ['net', 'core', 'util']),
  allow('store', ['store', 'core', 'util']),
  allow('data', ['data', 'core', 'store', 'util']),
  allow('draft', ['draft', 'core', 'data', 'util']),
  allow('themes', ['themes', 'core', 'scene', 'util']),
  allow('scene', ['scene', 'core', 'games', 'themes', 'data', 'store', 'util']),
  allow('voice', ['voice', 'core', 'net', 'store', 'util']),
  allow('ui', ['ui', 'scene', 'core', 'net', 'store', 'data', 'draft', 'games', 'themes', 'voice', 'util']),
  allow('debug', ['debug', 'core', 'net', 'store', 'data', 'draft', 'scene', 'themes', 'ui', 'voice', 'games', 'util']),
];

const NO_BROWSER_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'WebSocket', 'RTCPeerConnection', 'BroadcastChannel', 'Date', 'performance'].map((name) => ({
  name,
  message: 'core/ is pure: no DOM, clock or network. Inject what you need.',
}));

const PURE_IMPORTS = {
  patterns: [
    { group: ['three', 'three/*', 'troika-three-text', 'svelte', 'svelte/*', 'trystero', 'trystero/*', 'idb'], message: 'This module may not import rendering, UI, network or storage libraries.' },
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', 'dist-test/**', 'node_modules/**', 'artifacts/**', 'test-results/**', 'playwright-report/**', 'dev-dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node, __SPELLPLANE_DEBUG__: 'readonly' } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { projectService: false, extraFileExtensions: ['.svelte'], parser: tseslint.parser, svelteConfig } },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.svelte'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': ELEMENTS,
      'boundaries/include': ['src/**/*'],
      'import/resolver': { typescript: { alwaysTryTypes: true }, node: true },
    },
    rules: {
      'boundaries/dependencies': [2, { default: 'disallow', policies: POLICIES }],
    },
  },
  {
    files: ['src/core/**/*.ts', 'src/net/**/*.ts', 'src/draft/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...NO_BROWSER_GLOBALS],
      'no-restricted-imports': ['error', PURE_IMPORTS],
    },
  },
  {
    files: ['src/core/**/*.ts', 'src/draft/**/*.ts', 'src/games/**/*.ts', 'src/data/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: { 'no-restricted-imports': ['error', PURE_IMPORTS] },
  },
  {
    files: ['src/net/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['three', 'three/*', 'svelte', 'svelte/*', 'troika-three-text'], message: 'net/ may not import rendering or UI libraries.' }] }] },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
