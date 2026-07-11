import { serve } from '@hono/node-server'
import { createDemoApp } from './app.js'

const port = Number(process.env.PORT ?? 4321)
serve({ fetch: createDemoApp().fetch, port }, (info) => {
  console.log(`demo-app running on http://localhost:${info.port}`)
})
