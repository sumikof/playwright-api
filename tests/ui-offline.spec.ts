import { test, expect } from '@playwright/test'
import { serve, type ServerType } from '@hono/node-server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/core/http/app.js'
import { FileRunStore } from '../src/core/run/store.js'
import { Queue } from '../src/core/run/queue.js'
import { Runner } from '../src/core/run/runner.js'
import { RunService } from '../src/core/run/service.js'
import { createBrowserProvider } from '../src/core/browser/provider.js'
import { loginScenario } from '../src/scenarios/login.js'
import type { RunJob } from '../src/core/run/types.js'

let server: ServerType
let runsDir: string
let provider: ReturnType<typeof createBrowserProvider>
let baseURL: string

test.beforeAll(async () => {
  runsDir = await mkdtemp(join(tmpdir(), 'ui-'))
  provider = createBrowserProvider({
    port: 0,
    baseURL: 'http://localhost:1',
    browser: 'chromium',
    headless: true,
    browserLaunchArgs: [],
    maxConcurrency: 1,
    maxQueue: 100,
    runsDir,
    runRetention: 50,
    scenarioTimeoutMs: 120000,
  })
  const store = new FileRunStore(runsDir)
  const runner = new Runner({ provider, store, baseURL: 'http://localhost:1', runsDir, timeoutMs: 120000 })
  const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 100 }, (job) => runner.run(job))
  const service = new RunService(queue, store)
  const app = createApp({ scenarios: [loginScenario], service, runsDir })

  server = serve({ fetch: app.fetch, port: 0 })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo
  baseURL = `http://localhost:${port}`
})

test.afterAll(async () => {
  try {
    if (provider) await provider.close()
  } catch {}
  try {
    if (server) server.close()
  } catch {}
  try {
    if (runsDir) await rm(runsDir, { recursive: true, force: true })
  } catch {}
})

test('/ui makes zero external requests when rendered', async ({ page }) => {
  const external: string[] = []
  page.on('request', (req) => {
    const h = new URL(req.url()).hostname
    if (h !== 'localhost' && h !== '127.0.0.1') external.push(req.url())
  })
  await page.goto(`${baseURL}/ui`, { waitUntil: 'networkidle' })
  expect(external, `external requests: ${external.join(', ')}`).toEqual([])
  await expect(page.locator('#swagger-ui')).toBeVisible()
})
