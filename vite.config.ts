import { defineConfig } from 'vitest/config';

// BASE_PATH is set by the deploy workflow: "/horseshoes/" for main,
// "/horseshoes/preview/<branch>/" for branch previews.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { testTimeout: 60_000 },
});
