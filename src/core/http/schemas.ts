import { z } from '@hono/zod-openapi'

export const runStatusSchema = z.enum(['queued', 'running', 'passed', 'failed', 'interrupted'])

export const stepResultSchema = z.object({
  name: z.string(),
  status: z.enum(['passed', 'failed']),
  durationMs: z.number(),
  error: z.object({ message: z.string() }).optional(),
})

export const artifactSchema = z.object({
  kind: z.enum(['screenshot', 'trace']),
  name: z.string(),
  url: z.string(),
})

export const acceptedSchema = z.object({
  runId: z.string(),
  status: z.literal('queued'),
})

export const errorSchema = z.object({
  error: z.object({ message: z.string() }),
})

export const scenarioSummarySchema = z.object({
  id: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
})

export function runResultSchema(resultSchema: z.ZodType) {
  return z.object({
    runId: z.string(),
    scenarioId: z.string(),
    status: runStatusSchema,
    params: z.unknown(),
    queuedAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    durationMs: z.number().nullable(),
    steps: z.array(stepResultSchema),
    data: resultSchema.nullable(),
    error: z.object({ message: z.string(), stack: z.string().optional() }).nullable(),
    artifacts: z.array(artifactSchema),
  })
}
