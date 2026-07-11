import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from '@hono/zod-openapi'
import { createApp } from './app.js'
import { defineScenario } from '../scenario.js'
import { Queue } from '../run/queue.js'
import { FileRunStore } from '../run/store.js'
import { RunService } from '../run/service.js'
import type { RunJob } from '../run/types.js'

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
})
