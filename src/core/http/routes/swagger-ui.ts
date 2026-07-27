import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { OpenAPIHono } from '@hono/zod-openapi'

// ESM ではトップレベル __dirname/require が使えないため、
// createRequire(import.meta.url) 経由で swagger-ui-dist のパッケージディレクトリを解決する。
const require = createRequire(import.meta.url)
const swaggerUiDistDir = dirname(require.resolve('swagger-ui-dist/swagger-ui-bundle.js'))

// パストラバーサル防止のため、配信するファイルをホワイトリストで限定する。
const ASSET_CONTENT_TYPES: Record<string, string> = {
  'swagger-ui.css': 'text/css',
  'swagger-ui-bundle.js': 'application/javascript',
  'swagger-ui-standalone-preset.js': 'application/javascript',
}

function renderSwaggerHtml(): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Playwright E2E API - Swagger UI</title>
    <link rel="stylesheet" href="/ui/assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/ui/assets/swagger-ui-bundle.js"></script>
    <script src="/ui/assets/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/doc',
        dom_id: '#swagger-ui',
        validatorUrl: null,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      })
    </script>
  </body>
</html>
`
}

export function registerSwaggerUI(app: OpenAPIHono): void {
  app.get('/ui', (c) => c.html(renderSwaggerHtml()))

  app.get('/ui/assets/:file', async (c) => {
    const file = c.req.param('file')
    const contentType = ASSET_CONTENT_TYPES[file]
    if (!contentType) return c.notFound()
    const buffer = await readFile(join(swaggerUiDistDir, file))
    return c.body(buffer, 200, { 'Content-Type': contentType })
  })
}
