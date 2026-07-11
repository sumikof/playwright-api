import { defineConfig } from '@playwright/test'

const PORT = 4321
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  use: { baseURL },
  webServer: {
    command: `npx tsx fixtures/demo-app/server.ts`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
})
