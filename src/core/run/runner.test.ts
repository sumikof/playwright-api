import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { LocalBrowserProvider } from '../browser/local.js'
import { FileRunStore } from './store.js'
import { Runner } from './runner.js'
import { defineScenario } from '../scenario.js'
import type { RunJob } from './types.js'

const provider = new LocalBrowserProvider({ browser: 'chromium', headless: true })
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'runner-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
afterAll(async () => { await provider.close() })

const okScenario = defineScenario({
  id: 'ok',
  summary: 'always passes',
  tags: [],
  params: z.object({}),
  result: z.object({ value: z.string() }),
  async run(ctx) {
    await ctx.step('render', async () => {
      await ctx.page.setContent('<h1>ok</h1>')
    })
    await ctx.screenshot('done')
    return { value: 'hello' }
  },
})

const failScenario = defineScenario({
  id: 'fail',
  summary: 'always fails',
  tags: [],
  params: z.object({}),
  result: z.object({}),
  async run(ctx) {
    await ctx.page.setContent('<h1>fail</h1>')
    await ctx.step('boom', async () => { throw new Error('kaboom') })
    return {}
  },
})

function job(scenario: RunJob['scenario'], runId: string): RunJob {
  return { runId, scenario, params: {}, queuedAt: '2026-07-10T00:00:00.000Z' }
}

describe('Runner', () => {
  it('runs a passing scenario, validates result, keeps screenshot, no trace', async () => {
    const store = new FileRunStore(dir)
    const runner = new Runner({ provider, store, baseURL: 'http://x.test', runsDir: dir, timeoutMs: 30000 })
    await store.create('P1', 'ok', {}, '2026-07-10T00:00:00.000Z')
    await runner.run(job(okScenario, 'P1'))
    const result = await store.get('P1')
    expect(result?.status).toBe('passed')
    expect(result?.data).toEqual({ value: 'hello' })
    expect(result?.startedAt).not.toBeNull()
    expect(result?.durationMs).toBeGreaterThanOrEqual(0)
    const files = await readdir(join(dir, 'P1'))
    expect(files).toContain('01-done.png')
    expect(files).not.toContain('trace.zip')
  })

  it('runs a failing scenario, saves failure.png and trace.zip', async () => {
    const store = new FileRunStore(dir)
    const runner = new Runner({ provider, store, baseURL: 'http://x.test', runsDir: dir, timeoutMs: 30000 })
    await store.create('F1', 'fail', {}, '2026-07-10T00:00:00.000Z')
    await runner.run(job(failScenario, 'F1'))
    const result = await store.get('F1')
    expect(result?.status).toBe('failed')
    expect(result?.data).toBeNull()
    expect(result?.error?.message).toContain('kaboom')
    const kinds = result?.artifacts.map((a) => a.name) ?? []
    expect(kinds).toContain('failure.png')
    expect(kinds).toContain('trace.zip')
  })
})
