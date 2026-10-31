import { defineConfig } from 'vitest/config';

// BASE_PATH is set by the deploy workflow: "/horseshoes/" for main,
// "/horseshoes/preview/<branch>/" for branch previews.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // Online play only pairs players on the same build; CI stamps the commit here.
  define: { __BUILD__: JSON.stringify(process.env.GITHUB_SHA ?? 'dev') },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { testTimeout: 60_000 },
});
