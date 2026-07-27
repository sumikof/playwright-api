import { defineConfig } from '@playwright/test'

const DEMO_PORT = 4321
const baseURL = process.env.BASE_URL ?? `http://localhost:${DEMO_PORT}`
const useDemo = !process.env.BASE_URL // BASE_URL 未指定時のみデモを起動

export default defineConfig({
  timeout: 60000,
  use: { baseURL },
  // デモ spec は projects の opt-in。BASE_URL 未指定時のみデモ project を追加
  projects: [
    { name: 'default', testDir: './tests', testMatch: '**/*.spec.ts' },
    ...(useDemo ? [{ name: 'demo', testDir: './examples/e2e', testMatch: '**/*.spec.ts' }] : []),
  ],
  ...(useDemo
    ? {
        webServer: {
          command: `npx tsx fixtures/demo-app/server.ts`,
          url: `http://localhost:${DEMO_PORT}`,
          reuseExistingServer: !process.env.CI,
          env: { PORT: String(DEMO_PORT) },
        },
      }
    : {}),
})
