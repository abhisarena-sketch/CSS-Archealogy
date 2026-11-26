import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (p: string) => fileURLToPath(new URL(`./packages/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@css-archaeology\/core\/node$/, replacement: pkg('core/src/node/index.ts') },
      { find: /^@css-archaeology\/core$/, replacement: pkg('core/src/index.ts') },
      { find: /^@css-archaeology\/analyzers$/, replacement: pkg('analyzers/src/index.ts') },
      { find: /^@css-archaeology\/framework-adapters$/, replacement: pkg('framework-adapters/src/index.ts') },
      { find: /^css-archaeology$/, replacement: pkg('cli/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
