import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import type { AnyScenario } from '../../scenario.js'
import type { RunService } from '../../run/service.js'
import { runResultSchema, acceptedSchema, errorSchema, scenarioSummarySchema } from '../schemas.js'

export function registerScenarioRoutes(app: OpenAPIHono, scenarios: AnyScenario[], service: RunService): void {
  const listRoute = createRoute({
    method: 'get',
    path: '/scenarios',
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(scenarioSummarySchema) } },
        description: 'Scenario catalog',
      },
    },
  })
  app.openapi(listRoute, (c) =>
    c.json(scenarios.map((s) => ({ id: s.id, summary: s.summary, tags: s.tags })), 200),
  )

  for (const scenario of scenarios) {
    const postRoute = createRoute({
      method: 'post',
      path: `/scenarios/${scenario.id}/runs`,
      tags: [scenario.id],
      request: {
        body: { content: { 'application/json': { schema: scenario.params } }, required: true },
      },
      responses: {
        202: { content: { 'application/json': { schema: acceptedSchema } }, description: 'Run accepted' },
        503: { content: { 'application/json': { schema: errorSchema } }, description: 'Queue full' },
      },
    })
    app.openapi(postRoute, async (c) => {
      const params = c.req.valid('json')
      const result = await service.submit(scenario, params)
      if (!result.ok) return c.json({ error: { message: 'Queue is full' } }, 503)
      return c.json({ runId: result.runId, status: 'queued' as const }, 202)
    })

    const getRoute = createRoute({
      method: 'get',
      path: `/scenarios/${scenario.id}/runs/{runId}`,
      tags: [scenario.id],
      request: { params: z.object({ runId: z.string() }) },
      responses: {
        200: { content: { 'application/json': { schema: runResultSchema(scenario.result) } }, description: 'Run result' },
        404: { content: { 'application/json': { schema: errorSchema } }, description: 'Not found' },
      },
    })
    app.openapi(getRoute, async (c) => {
      const { runId } = c.req.valid('param')
      const run = await service.getResult(runId)
      if (!run || run.scenarioId !== scenario.id) {
        return c.json({ error: { message: 'Run not found' } }, 404)
      }
      return c.json(run, 200)
    })
  }
}
