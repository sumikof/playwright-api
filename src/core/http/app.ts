import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import type { AnyScenario } from '../scenario.js'
import type { RunService } from '../run/service.js'
import { registerHealthRoute } from './routes/health.js'
import { registerScenarioRoutes } from './routes/scenarios.js'
import { registerArtifactRoute } from './routes/artifacts.js'

export interface AppDeps {
  scenarios: AnyScenario[]
  service: RunService
  runsDir: string
}

export function createApp(deps: AppDeps): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: { message: 'Invalid request' } }, 400)
      }
    },
  })

  registerHealthRoute(app)
  registerScenarioRoutes(app, deps.scenarios, deps.service)
  registerArtifactRoute(app, deps.service, deps.runsDir)

  app.doc('/doc', {
    openapi: '3.0.0',
    info: { title: 'Playwright E2E API', version: '1.0.0' },
  })
  app.get('/ui', swaggerUI({ url: '/doc' }))

  return app
}
