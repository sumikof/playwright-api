import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { serve, type ServerType } from '@hono/node-server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDemoApp } from '../fixtures/demo-app/app.js'
import { createApp } from '../src/core/http/app.js'
import { FileRunStore } from '../src/core/run/store.js'
import { Queue } from '../src/core/run/queue.js'
import { Runner } from '../src/core/run/runner.js'
import { RunService } from '../src/core/run/service.js'
import { createBrowserProvider } from '../src/core/browser/provider.js'
import { loginScenario } from '../src/scenarios/login.js'
import type { RunJob } from '../src/core/run/types.js'
import type { Hono } from 'hono'
import type { AddressInfo } from 'node:net'
import { seedSqlite } from '../fixtures/demo-db/seed.js'
import { loadConfig } from '../src/core/config.js'
import { createDbProvider, type DbProvider } from '../src/core/db/provider.js'
import { buildQueryRegistry } from '../src/core/db/query.js'
import { queries } from '../src/queries/index.js'

const DEMO_PORT = 4399
let demoServer: ServerType
let runsDir: string
let app: Hono
let provider: ReturnType<typeof createBrowserProvider>

beforeAll(async () => {
  demoServer = serve({ fetch: createDemoApp().fetch, port: DEMO_PORT })
  runsDir = await mkdtemp(join(tmpdir(), 'integ-'))
  const baseURL = `http://localhost:${DEMO_PORT}`
  provider = createBrowserProvider({
    port: 0, baseURL, browser: 'chromium', headless: true,
    maxConcurrency: 1, maxQueue: 100, runsDir, runRetention: 50, scenarioTimeoutMs: 120000,
  })
  const store = new FileRunStore(runsDir)
  const runner = new Runner({ provider, store, baseURL, runsDir, timeoutMs: 120000 })
  const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 100 }, (job) => runner.run(job))
  const service = new RunService(queue, store)
  app = createApp({ scenarios: [loginScenario], service, runsDir })
})

afterAll(async () => {
  try { if (provider) await provider.close() } catch {}
  try { if (demoServer) demoServer.close() } catch {}
  try { if (runsDir) await rm(runsDir, { recursive: true, force: true }) } catch {}
})

async function poll(runId: string): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const res = await app.request(`/scenarios/login/runs/${runId}`)
    const body = await res.json()
    if (body.status === 'passed' || body.status === 'failed') return body
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('run did not settle in time')
}

async function submit(password: string): Promise<string> {
  const res = await app.request('/scenarios/login/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', password }),
  })
  expect(res.status).toBe(202)
  return (await res.json()).runId
}

describe('API integration', () => {
  it('runs the login scenario end-to-end and returns passed', async () => {
    const runId = await submit('correct-password')
    const body = await poll(runId)
    expect(body.status).toBe('passed')
    expect(body.data.userName).toBe('テストユーザー')
    expect(body.artifacts.some((a: any) => a.name === '01-product-list.png')).toBe(true)
  })

  it('returns failed with trace and failure screenshot on wrong password', async () => {
    const runId = await submit('wrong-password')
    const body = await poll(runId)
    expect(body.status).toBe('failed')
    const names = body.artifacts.map((a: any) => a.name)
    expect(names).toContain('trace.zip')
    expect(names).toContain('failure.png')
  })
})

describe('query API integration', () => {
  let queryServer: ServerType
  let queryDir: string
  let db: DbProvider | null
  let url: string

  beforeAll(async () => {
    // Provider は readOnly で開くため、seed → サーバ起動 → POST の順
    queryDir = await mkdtemp(join(tmpdir(), 'integ-db-'))
    const file = join(queryDir, 'demo.sqlite')
    seedSqlite(file)
    const config = loadConfig({ BASE_URL: 'http://localhost', DB_DIALECT: 'sqlite', DB_SQLITE_FILE: file, RUNS_DIR: queryDir })
    db = createDbProvider(config)
    buildQueryRegistry(queries, { maxRows: config.db.maxRows })
    const store = new FileRunStore(queryDir)
    const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 1 }, async () => {})
    const queryApp = createApp({
      scenarios: [],
      service: new RunService(queue, store),
      runsDir: queryDir,
      queries: { queries, db, maxRows: config.db.maxRows, timeoutMs: config.db.queryTimeoutMs },
    })
    queryServer = await new Promise<ServerType>((resolve) => {
      const s = serve({ fetch: queryApp.fetch, port: 0 }, () => resolve(s))
    })
    url = `http://127.0.0.1:${(queryServer.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    try { if (queryServer) await new Promise((r) => queryServer.close(r)) } catch {}
    try { if (db) await db.close() } catch {}
    try { if (queryDir) await rm(queryDir, { recursive: true, force: true }) } catch {}
  })

  it('runs the sample products query over HTTP', async () => {
    const res = await fetch(`${url}/queries/products`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ minPrice: 400 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rowCount).toBe(2)
    expect(body.rows.map((r: any) => r.name)).toEqual(['商品B', '商品C'])
  })
})
