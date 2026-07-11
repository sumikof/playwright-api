import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { Queue } from './queue.js'
import { FileRunStore } from './store.js'
import { RunService } from './service.js'
import { defineScenario } from '../scenario.js'
import type { RunJob } from './types.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'svc-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const scenario = defineScenario({
  id: 'noop', summary: '', tags: [], params: z.object({}), result: z.object({}),
  async run() { return {} },
})

describe('RunService', () => {
  it('creates meta and enqueues on submit', async () => {
    const store = new FileRunStore(dir)
    const seen: string[] = []
    const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 10 }, async (job) => {
      seen.push(job.runId)
    })
    const service = new RunService(queue, store)
    const r = await service.submit(scenario, {})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(await store.get(r.runId)).toBeDefined()
      await queue.drain()
      expect(seen).toContain(r.runId)
    }
  })

  it('returns ok:false when queue has no capacity', async () => {
    const store = new FileRunStore(dir)
    const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 1 }, async () => {
      await new Promise(() => {}) // 走り続ける
    })
    const service = new RunService(queue, store)
    await service.submit(scenario, {}) // running
    await service.submit(scenario, {}) // waiting (maxQueue=1)
    const third = await service.submit(scenario, {})
    expect(third.ok).toBe(false)
  })
})
