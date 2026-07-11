import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/**/*.spec.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
