import { serve } from '@hono/node-server'
import { loadConfig } from './core/config.js'
import { createBrowserProvider } from './core/browser/provider.js'
import { FileRunStore } from './core/run/store.js'
import { Queue } from './core/run/queue.js'
import { Runner } from './core/run/runner.js'
import { RunService } from './core/run/service.js'
import { pruneRuns } from './core/run/retention.js'
import { createApp } from './core/http/app.js'
import { scenarios } from './scenarios/index.js'
import { buildRegistry } from './core/registry.js'
import { createDbProvider } from './core/db/provider.js'
import { buildQueryRegistry } from './core/db/query.js'
import { queries } from './queries/index.js'
import { gracefulShutdown, shutdownBudget } from './core/lifecycle.js'
import type { RunJob } from './core/run/types.js'

async function main(): Promise<void> {
  const config = loadConfig()

  // 起動時に1度だけ保持期間の掃除
  await pruneRuns(config.runsDir, config.runRetention)

  // ID重複を起動時に検出（例外で落とす）
  buildRegistry(scenarios)
  // クエリ定義の不備(id 重複・非 SELECT・バインド不整合・maxRows)も起動時に検出する
  buildQueryRegistry(queries, { maxRows: config.db.maxRows })

  const provider = createBrowserProvider(config)
  const store = new FileRunStore(config.runsDir)
  const runner = new Runner({
    provider,
    store,
    baseURL: config.baseURL,
    runsDir: config.runsDir,
    timeoutMs: config.scenarioTimeoutMs,
  })
  const queue = new Queue<RunJob>(
    { maxConcurrency: config.maxConcurrency, maxQueue: config.maxQueue },
    (job) => runner.run(job),
  )
  const service = new RunService(queue, store)
  const db = createDbProvider(config)
  const budget = shutdownBudget({
    dbQueryTimeoutMs: config.db.queryTimeoutMs,
    dbShutdownDrainS: config.db.shutdownDrainS,
  })
  const app = createApp({
    scenarios,
    service,
    runsDir: config.runsDir,
    queries: { queries, db, maxRows: config.db.maxRows, timeoutMs: config.db.queryTimeoutMs },
  })

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Playwright E2E API listening on http://localhost:${info.port}`)
    console.log(`  Swagger UI: http://localhost:${info.port}/ui`)
    console.log(`  Database: ${db ? db.dialect : 'disabled (DB_DIALECT unset)'}`)
    console.log(`  Recommended terminationGracePeriodSeconds: >= ${budget.terminationGracePeriodSeconds}`)
  })

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`${signal} received, shutting down...`)
    await gracefulShutdown({ server, queue, provider, db, drainTimeoutMs: budget.drainTimeoutMs })
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException', err)
    process.exit(1)
  })
  process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection', err)
    process.exit(1)
  })
}

main().catch((err) => {
  console.error('Fatal startup error', err)
  process.exit(1)
})
