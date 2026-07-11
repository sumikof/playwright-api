import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import type { RunService } from '../../run/service.js'
import { errorSchema } from '../schemas.js'

function contentTypeFor(name: string): string {
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.zip')) return 'application/zip'
  return 'application/octet-stream'
}

export function registerArtifactRoute(app: OpenAPIHono, service: RunService, runsDir: string): void {
  const route = createRoute({
    method: 'get',
    path: '/runs/{runId}/artifacts/{name}',
    request: { params: z.object({ runId: z.string(), name: z.string() }) },
    responses: {
      200: {
        content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
        description: 'Artifact file',
      },
      404: { content: { 'application/json': { schema: errorSchema } }, description: 'Not found' },
    },
  })
  app.openapi(route, async (c) => {
    const { runId, name } = c.req.valid('param')
    const run = await service.getResult(runId)
    if (!run) return c.json({ error: { message: 'Run not found' } }, 404)
    // result.json の artifacts[] に載っている名前だけを配信する（パストラバーサル防止）
    const artifact = run.artifacts.find((a) => a.name === name)
    if (!artifact) return c.json({ error: { message: 'Artifact not found' } }, 404)
    const buffer = await readFile(join(runsDir, runId, name))
    return c.newResponse(buffer, 200, { 'Content-Type': contentTypeFor(name) })
  })
}
