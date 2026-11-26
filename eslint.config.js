import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.next/**', '**/out/**', 'coverage/**', 'examples/**', 'bench-results/**', '**/next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Security: CSS Archaeology must never evaluate code.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': ['error', { object: 'vm', message: 'Do not run project code.' }],
      'no-restricted-imports': ['error', { paths: [{ name: 'node:vm', message: 'Do not run project code.' }, { name: 'vm', message: 'Do not run project code.' }, { name: 'child_process', message: 'The analyzer must not spawn processes.' }, { name: 'node:child_process', message: 'The analyzer must not spawn processes.' }] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The engine must stay browser-safe: no Node built-ins outside core/src/node.
    files: ['packages/core/src/**/*.ts', 'packages/analyzers/src/**/*.ts', 'packages/framework-adapters/src/**/*.ts'],
    ignores: ['packages/core/src/node/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*', 'fs', 'path', 'os', 'child_process', 'vm'], message: 'Engine code must be browser-safe. Put Node-specific code in @css-archaeology/core/node.' }] }],
    },
  },
  {
    files: ['apps/playground/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
