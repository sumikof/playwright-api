import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'

export function registerHealthRoute(app: OpenAPIHono): void {
  const route = createRoute({
    method: 'get',
    path: '/health',
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
        description: 'Health check',
      },
    },
  })
  app.openapi(route, (c) => c.json({ status: 'ok' as const }, 200))
}
