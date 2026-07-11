import { join } from 'node:path'
import type { BrowserContext } from 'playwright'
import type { BrowserProvider } from '../browser/provider.js'
import type { RunStore } from './store.js'
import { ApiScenarioContext } from './context.js'
import type { RunJob, RunResult, Artifact } from './types.js'

export interface RunnerDeps {
  provider: BrowserProvider
  store: RunStore
  baseURL: string
  runsDir: string
  timeoutMs: number
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
function errStack(e: unknown): string | undefined {
  return e instanceof Error ? e.stack : undefined
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Scenario timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export class Runner {
  constructor(private readonly deps: RunnerDeps) {}

  async run(job: RunJob): Promise<void> {
    const startedAt = new Date().toISOString()
    const startMs = Date.now()
    await this.deps.store.markRunning(job.runId, startedAt)

    const runDir = join(this.deps.runsDir, job.runId)
    let context: BrowserContext | undefined
    let status: 'passed' | 'failed' = 'passed'
    let data: unknown = null
    let error: { message: string; stack?: string } | null = null
    let steps: RunResult['steps'] = []
    let artifacts: Artifact[] = []

    try {
      context = await this.deps.provider.acquireContext({ baseURL: this.deps.baseURL })
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      const page = await context.newPage()
      const sctx = new ApiScenarioContext(page, this.deps.baseURL, runDir, job.runId)

      try {
        const raw = await withTimeout(job.scenario.run(sctx, job.params), this.deps.timeoutMs)
        const parsed = job.scenario.result.safeParse(raw)
        if (parsed.success) {
          data = parsed.data
        } else {
          status = 'failed'
          error = { message: `Result did not match schema: ${parsed.error.message}` }
        }
      } catch (e) {
        status = 'failed'
        error = { message: errMessage(e), stack: errStack(e) }
        try {
          await page.screenshot({ path: join(runDir, 'failure.png'), fullPage: true })
          sctx.artifacts.push({ kind: 'screenshot', name: 'failure.png', url: `/runs/${job.runId}/artifacts/failure.png` })
        } catch {
          // screenshot failure is swallowed (prioritize the original error)
        }
      } finally {
        if (status === 'failed') {
          await context.tracing.stop({ path: join(runDir, 'trace.zip') })
          sctx.artifacts.push({ kind: 'trace', name: 'trace.zip', url: `/runs/${job.runId}/artifacts/trace.zip` })
        } else {
          await context.tracing.stop()
        }
      }

      steps = sctx.steps
      artifacts = sctx.artifacts
    } catch (e) {
      // failure acquiring context or starting tracing
      status = 'failed'
      error = { message: errMessage(e), stack: errStack(e) }
    } finally {
      if (context) {
        try {
          await context.close()
        } catch {
          // ignore
        }
      }
    }

    const finishedAt = new Date().toISOString()
    const result: RunResult = {
      runId: job.runId,
      scenarioId: job.scenario.id,
      status,
      params: job.params,
      queuedAt: job.queuedAt,
      startedAt,
      finishedAt,
      durationMs: Date.now() - startMs,
      steps,
      data: status === 'passed' ? data : null,
      error,
      artifacts,
    }
    await this.deps.store.finish(job.runId, result)
  }
}
