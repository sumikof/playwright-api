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
import type { RunJob } from './core/run/types.js'

async function main(): Promise<void> {
  const config = loadConfig()

  // 起動時に1度だけ保持期間の掃除
  await pruneRuns(config.runsDir, config.runRetention)

  // ID重複を起動時に検出（例外で落とす）
  buildRegistry(scenarios)

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
  const app = createApp({ scenarios, service, runsDir: config.runsDir })

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Playwright E2E API listening on http://localhost:${info.port}`)
    console.log(`  Swagger UI: http://localhost:${info.port}/ui`)
  })

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`${signal} received, shutting down...`)
    server.close()
    const drainWithTimeout = Promise.race([
      queue.drain(),
      new Promise<void>((resolve) => setTimeout(resolve, 30000)),
    ])
    await drainWithTimeout
    await provider.close()
    process.exit(0)
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

void main()
