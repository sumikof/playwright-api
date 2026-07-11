import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunResult, RunMeta } from './types.js'

export interface RunStore {
  create(runId: string, scenarioId: string, params: unknown, queuedAt: string): Promise<void>
  markRunning(runId: string, startedAt: string): Promise<void>
  finish(runId: string, result: RunResult): Promise<void>
  get(runId: string): Promise<RunResult | undefined>
}

export class FileRunStore implements RunStore {
  private readonly memory = new Map<string, RunResult>()

  constructor(private readonly runsDir: string) {}

  private runDir(runId: string): string {
    return join(this.runsDir, runId)
  }

  async create(runId: string, scenarioId: string, params: unknown, queuedAt: string): Promise<void> {
    const queued: RunResult = {
      runId,
      scenarioId,
      status: 'queued',
      params,
      queuedAt,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      steps: [],
      data: null,
      error: null,
      artifacts: [],
    }
    this.memory.set(runId, queued)
    const meta: RunMeta = { runId, scenarioId, params, queuedAt }
    await mkdir(this.runDir(runId), { recursive: true })
    await writeFile(join(this.runDir(runId), 'meta.json'), JSON.stringify(meta, null, 2))
  }

  async markRunning(runId: string, startedAt: string): Promise<void> {
    const entry = this.memory.get(runId)
    if (entry) {
      entry.status = 'running'
      entry.startedAt = startedAt
    }
  }

  async finish(runId: string, result: RunResult): Promise<void> {
    this.memory.set(runId, result)
    await mkdir(this.runDir(runId), { recursive: true })
    await writeFile(join(this.runDir(runId), 'result.json'), JSON.stringify(result, null, 2))
    // Bound memory to in-flight (queued/running) runs; get() falls back to
    // reading result.json from disk for finished runs.
    this.memory.delete(runId)
  }

  async get(runId: string): Promise<RunResult | undefined> {
    const inMemory = this.memory.get(runId)
    if (inMemory) return inMemory

    const resultJson = await this.tryRead(join(this.runDir(runId), 'result.json'))
    if (resultJson) return JSON.parse(resultJson) as RunResult

    const metaJson = await this.tryRead(join(this.runDir(runId), 'meta.json'))
    if (metaJson) {
      const meta = JSON.parse(metaJson) as RunMeta
      return {
        runId: meta.runId,
        scenarioId: meta.scenarioId,
        status: 'interrupted',
        params: meta.params,
        queuedAt: meta.queuedAt,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        steps: [],
        data: null,
        error: { message: 'Run interrupted by process restart' },
        artifacts: [],
      }
    }

    return undefined
  }

  private async tryRead(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    }
  }
}
