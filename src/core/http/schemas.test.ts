import { describe, it, expect } from 'vitest'
import { z } from '@hono/zod-openapi'
import { runResultSchema, acceptedSchema } from './schemas.js'

describe('schemas', () => {
  it('runResultSchema embeds the result schema in data and allows null', () => {
    const schema = runResultSchema(z.object({ userName: z.string() }))
    const ok = schema.safeParse({
      runId: 'R1', scenarioId: 'login', status: 'passed', params: {},
      queuedAt: 't', startedAt: 't', finishedAt: 't', durationMs: 1,
      steps: [], data: { userName: 'x' }, error: null, artifacts: [],
    })
    expect(ok.success).toBe(true)
    const nullData = schema.safeParse({
      runId: 'R1', scenarioId: 'login', status: 'failed', params: {},
      queuedAt: 't', startedAt: null, finishedAt: null, durationMs: null,
      steps: [], data: null, error: { message: 'x' }, artifacts: [],
    })
    expect(nullData.success).toBe(true)
    const invalidData = schema.safeParse({
      runId: 'R1', scenarioId: 'login', status: 'passed', params: {},
      queuedAt: 't', startedAt: 't', finishedAt: 't', durationMs: 1,
      steps: [], data: { userName: 123 }, error: null, artifacts: [],
    })
    expect(invalidData.success).toBe(false)
  })

  it('acceptedSchema requires queued status', () => {
    expect(acceptedSchema.safeParse({ runId: 'R1', status: 'queued' }).success).toBe(true)
    expect(acceptedSchema.safeParse({ runId: 'R1', status: 'running' }).success).toBe(false)
  })
})
