import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
