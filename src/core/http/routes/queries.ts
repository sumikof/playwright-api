import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import { effectiveMaxRows, resolveSql, toBinds, type AnyQuery } from '../../db/query.js'
import { DbClosedError, DbTimeoutError, RowLimitExceededError, type DbProvider } from '../../db/provider.js'
import { errorSchema, queryResultSchema, querySummarySchema } from '../schemas.js'

export interface QueryRouteDeps {
  queries: AnyQuery[]
  /** DB_DIALECT 未設定なら null(POST は 503) */
  db: DbProvider | null
  /** DB_MAX_ROWS */
  maxRows: number
  /** DB_QUERY_TIMEOUT_MS */
  timeoutMs: number
}

export function registerQueryRoutes(app: OpenAPIHono, deps: QueryRouteDeps): void {
  const listRoute = createRoute({
    method: 'get',
    path: '/queries',
    tags: ['queries'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(querySummarySchema) } },
        description: 'Query catalog',
      },
    },
  })
  app.openapi(listRoute, (c) =>
    c.json(deps.queries.map((q) => ({ id: q.id, summary: q.summary, tags: q.tags })), 200),
  )

  const error = (description: string) => ({ content: { 'application/json': { schema: errorSchema } }, description })

  for (const query of deps.queries) {
    const postRoute = createRoute({
      method: 'post',
      path: `/queries/${query.id}`,
      tags: ['queries'],
      summary: query.summary,
      request: {
        body: { content: { 'application/json': { schema: query.params } }, required: true },
      },
      responses: {
        200: { content: { 'application/json': { schema: queryResultSchema(query.row) } }, description: 'Query result' },
        400: error('Invalid params'),
        500: error('Query failed, row schema mismatch or row limit exceeded'),
        503: error('Database is not configured or shutting down'),
        504: error('Query timed out'),
      },
    })
    app.openapi(postRoute, async (c) => {
      const db = deps.db
      if (!db) return c.json({ error: { message: 'Database is not configured (DB_DIALECT)' } }, 503)

      const params = c.req.valid('json') as Record<string, unknown>
      const sql = resolveSql(query.sql, db.dialect)
      const maxRows = effectiveMaxRows(query, deps.maxRows)
      const started = performance.now()
      let rows: Record<string, unknown>[]
      try {
        rows = await db.query(sql, toBinds(sql, params), { timeoutMs: deps.timeoutMs, maxRows })
      } catch (err) {
        if (err instanceof RowLimitExceededError) return c.json({ error: { message: err.message } }, 500)
        if (err instanceof DbTimeoutError) return c.json({ error: { message: 'Query timed out' } }, 504)
        if (err instanceof DbClosedError) return c.json({ error: { message: 'Database is shutting down' } }, 503)
        // DB 内部の情報(ORA- コード、スキーマ名等)は応答に含めずログにだけ出す
        console.error(`query "${query.id}" failed`, err)
        return c.json({ error: { message: 'Query failed' } }, 500)
      }
      const durationMs = Math.round(performance.now() - started)

      const parsed = z.array(query.row).safeParse(rows)
      if (!parsed.success) {
        console.error(`query "${query.id}" returned rows that do not match the row schema`, z.prettifyError(parsed.error))
        return c.json({ error: { message: 'Query result does not match the row schema' } }, 500)
      }
      return c.json({ queryId: query.id, rowCount: parsed.data.length, durationMs, rows: parsed.data }, 200)
    })
  }
}
