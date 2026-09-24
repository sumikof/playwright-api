import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from '@hono/zod-openapi'
import { createApp } from './app.js'
import { defineScenario } from '../scenario.js'
import { Queue } from '../run/queue.js'
import { FileRunStore } from '../run/store.js'
import { RunService } from '../run/service.js'
import type { RunJob, RunResult } from '../run/types.js'
import { defineQuery, type AnyQuery } from '../db/query.js'
import { SqliteProvider } from '../db/sqlite.js'
import { DbClosedError, DbTimeoutError, type DbProvider } from '../db/provider.js'
import { createSqliteFile } from '../testing/sqlite.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'app-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const loginScenario = defineScenario({
  id: 'login',
  summary: 'log in',
  tags: ['auth'],
  params: z.object({ email: z.email(), password: z.string() }),
  result: z.object({ userName: z.string() }),
  async run() { return { userName: 'x' } },
})

function makeApp() {
  const store = new FileRunStore(dir)
  // worker は何もしない（ジョブを running のまま放置）。POST受理と store 経由のGETを検証する。
  const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 10 }, async () => {})
  const service = new RunService(queue, store)
  const app = createApp({ scenarios: [loginScenario], service, runsDir: dir })
  return { app, store, service }
}

describe('createApp', () => {
  it('lists scenarios', async () => {
    const { app } = makeApp()
    const res = await app.request('/scenarios')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'login', summary: 'log in', tags: ['auth'] }])
  })

  it('rejects invalid POST body with 400', async () => {
    const { app } = makeApp()
    const res = await app.request('/scenarios/login/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts a valid POST with 202 and a runId', async () => {
    const { app } = makeApp()
    const res = await app.request('/scenarios/login/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'pw' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.status).toBe('queued')
    expect(typeof body.runId).toBe('string')
  })

  it('returns 404 for unknown runId', async () => {
    const { app } = makeApp()
    const res = await app.request('/scenarios/login/runs/UNKNOWN')
    expect(res.status).toBe(404)
  })

  it('exposes the scenario POST path in the OpenAPI doc', async () => {
    const { app } = makeApp()
    const res = await app.request('/doc')
    const doc = await res.json()
    expect(doc.paths['/scenarios/login/runs']).toBeDefined()
    expect(doc.paths['/scenarios/login/runs'].post.requestBody).toBeDefined()
  })

  it('serves health', async () => {
    const { app } = makeApp()
    const res = await app.request('/health')
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('serves /ui without any external host URL and disables the validator', async () => {
    const { app } = makeApp()
    const res = await app.request('/ui')
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).not.toMatch(/https?:\/\/(?!localhost|127\.0\.0\.1)/) // 他ホスト URL 不在
    expect(html).toContain('validatorUrl') // 初期化に validatorUrl 指定
    expect(html).toMatch(/validatorUrl:\s*null/) // null で無効化
    expect(html).not.toContain('jsdelivr')
    expect(html).not.toContain('validator.swagger.io')
  })

  it('serves swagger-ui assets locally', async () => {
    const { app } = makeApp()
    const res = await app.request('/ui/assets/swagger-ui.css')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/css')
  })
})

describe('queue-full 503', () => {
  it('returns 503 once the queue (running + waiting) is saturated', async () => {
    const store = new FileRunStore(dir)
    // Worker hangs forever, so the first submission occupies the single
    // concurrency slot and never frees it during this test.
    const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 1 }, () => new Promise(() => {}))
    const service = new RunService(queue, store)
    const app = createApp({ scenarios: [loginScenario], service, runsDir: dir })

    const body = JSON.stringify({ email: 'a@b.com', password: 'pw' })
    const headers = { 'content-type': 'application/json' }

    const first = await app.request('/scenarios/login/runs', { method: 'POST', headers, body })
    expect(first.status).toBe(202) // occupies the running slot (worker hangs)

    const second = await app.request('/scenarios/login/runs', { method: 'POST', headers, body })
    expect(second.status).toBe(202) // fills the single waiting slot

    const third = await app.request('/scenarios/login/runs', { method: 'POST', headers, body })
    expect(third.status).toBe(503)
    expect(await third.json()).toEqual({ error: { message: 'Queue is full' } })
  })
})

describe('artifact route', () => {
  const runId = 'RART'
  const artifactName = '01-product-list.png'
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  async function seedRun(store: FileRunStore) {
    const result: RunResult = {
      runId,
      scenarioId: 'login',
      status: 'passed',
      params: {},
      queuedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 10,
      steps: [],
      data: { userName: 'x' },
      error: null,
      artifacts: [{ kind: 'screenshot', name: artifactName, url: `/runs/${runId}/artifacts/${artifactName}` }],
    }
    await store.finish(runId, result)
    const runDir = join(dir, runId)
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, artifactName), pngBytes)
  }

  it('serves a recorded artifact with the right content type', async () => {
    const { app, store } = makeApp()
    await seedRun(store)
    const res = await app.request(`/runs/${runId}/artifacts/${artifactName}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(pngBytes)).toBe(true)
  })

  it('rejects path-traversal and unrecorded artifact names with 404', async () => {
    const { app, store } = makeApp()
    await seedRun(store)

    const traversalRes = await app.request(
      `/runs/${runId}/artifacts/${encodeURIComponent('../../../etc/passwd')}`,
    )
    expect(traversalRes.status).toBe(404)

    const unrecordedRes = await app.request(`/runs/${runId}/artifacts/not-recorded.png`)
    expect(unrecordedRes.status).toBe(404)
  })

  it('returns 404 for an unknown run', async () => {
    const { app } = makeApp()
    const res = await app.request(`/runs/UNKNOWN/artifacts/${artifactName}`)
    expect(res.status).toBe(404)
  })
})

describe('query routes', () => {
  // src/ から fixtures/ は import できない(rootDir)ため seed.sql は fs で読む
  const seedSql = readFileSync(new URL('../../../fixtures/demo-db/seed.sql', import.meta.url), 'utf8')
  const productRow = z.object({ id: z.number(), name: z.string(), price: z.number() })
  const productsQuery = defineQuery({
    id: 'products',
    summary: 'products by min price',
    tags: ['catalog'],
    params: z.object({ minPrice: z.number().int().nonnegative().default(0) }),
    row: productRow,
    sql: 'SELECT id AS "id", name AS "name", price AS "price" FROM products WHERE price >= :minPrice ORDER BY id',
  })
  const badRowQuery = defineQuery({
    id: 'bad-row',
    summary: 'row schema mismatch',
    tags: [],
    params: z.object({}),
    row: z.object({ id: z.string() }),
    sql: 'SELECT id AS "id" FROM products',
  })
  const limitedQuery = defineQuery({
    id: 'limited',
    summary: 'more rows than maxRows',
    tags: [],
    params: z.object({}),
    row: productRow,
    sql: 'SELECT id AS "id", name AS "name", price AS "price" FROM products',
    maxRows: 2,
  })
  const queries = [productsQuery, badRowQuery, limitedQuery] as AnyQuery[]

  let db: SqliteProvider
  beforeEach(() => {
    const file = join(dir, 'demo.sqlite')
    createSqliteFile(file, seedSql)
    db = new SqliteProvider(file)
  })
  afterEach(async () => { await db.close() })

  function makeQueryApp(dbProvider: DbProvider | null, over: { maxRows?: number; timeoutMs?: number } = {}) {
    const store = new FileRunStore(dir)
    const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 10 }, async () => {})
    const service = new RunService(queue, store)
    return createApp({
      scenarios: [loginScenario],
      service,
      runsDir: dir,
      queries: { queries, db: dbProvider, maxRows: over.maxRows ?? 1000, timeoutMs: over.timeoutMs ?? 30000 },
    })
  }

  const post = (app: ReturnType<typeof makeQueryApp>, id: string, body: unknown) =>
    app.request(`/queries/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  function stubDb(query: DbProvider['query']): DbProvider & { query: ReturnType<typeof vi.fn> } {
    return { dialect: 'sqlite', query: vi.fn(query), close: async () => {} }
  }

  it('lists queries', async () => {
    const res = await makeQueryApp(db).request('/queries')
    expect(res.status).toBe(200)
    expect((await res.json())[0]).toEqual({ id: 'products', summary: 'products by min price', tags: ['catalog'] })
  })

  it('returns matching rows with 200', async () => {
    const res = await post(makeQueryApp(db), 'products', { minPrice: 400 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      queryId: 'products',
      rowCount: 2,
      rows: [
        { id: 2, name: '商品B', price: 480 },
        { id: 3, name: '商品C', price: 980 },
      ],
    })
    expect(typeof body.durationMs).toBe('number')
  })

  it('returns 200 with no rows when nothing matches', async () => {
    const res = await post(makeQueryApp(db), 'products', { minPrice: 99999 })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rowCount: 0, rows: [] })
  })

  it('applies params defaults', async () => {
    const res = await post(makeQueryApp(db), 'products', {})
    expect((await res.json()).rowCount).toBe(3)
  })

  it.each([{ minPrice: -1 }, { minPrice: 'x' }])('rejects invalid params %j with 400', async (body) => {
    const res = await post(makeQueryApp(db), 'products', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { message: 'Invalid request' } })
  })

  it('returns 500 when rows do not match the row schema', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post(makeQueryApp(db), 'bad-row', {})
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: { message: 'Query result does not match the row schema' } })
    errSpy.mockRestore()
  })

  it('returns 500 when the row limit is exceeded', async () => {
    const res = await post(makeQueryApp(db), 'limited', {})
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: { message: 'row limit exceeded (maxRows=2)' } })
  })

  it('returns 503 when the DB is not configured, but still lists queries', async () => {
    const app = makeQueryApp(null)
    const res = await post(app, 'products', {})
    expect(res.status).toBe(503)
    expect((await app.request('/queries')).status).toBe(200)
  })

  it('maps provider errors to 504 / 503 / 500', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cases: [Error, number, string][] = [
      [new DbTimeoutError(), 504, 'Query timed out'],
      [new DbClosedError(), 503, 'Database is shutting down'],
      [new Error('ORA-00942: table or view does not exist'), 500, 'Query failed'],
    ]
    for (const [err, status, message] of cases) {
      const res = await post(makeQueryApp(stubDb(async () => { throw err })), 'products', {})
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ error: { message } })
    }
    errSpy.mockRestore()
  })

  it('passes SQL binds, min(maxRows, DB_MAX_ROWS) and the timeout to the provider', async () => {
    const stub = stubDb(async () => [])
    const app = makeQueryApp(stub, { maxRows: 50, timeoutMs: 1234 })
    await post(app, 'products', { minPrice: 10 })
    expect(stub.query).toHaveBeenLastCalledWith(expect.stringContaining(':minPrice'), { minPrice: 10 }, { timeoutMs: 1234, maxRows: 50 })
    await post(app, 'limited', {})
    expect(stub.query).toHaveBeenLastCalledWith(expect.any(String), {}, { timeoutMs: 1234, maxRows: 2 })
  })

  it('exposes each query in the OpenAPI doc', async () => {
    const doc = await (await makeQueryApp(db).request('/doc')).json()
    const op = doc.paths['/queries/products'].post
    expect(op.requestBody).toBeDefined()
    expect(op.responses['200']).toBeDefined()
    expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(['400', '500', '503', '504']))
  })
})
