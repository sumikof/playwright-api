import type { AnyScenario } from '../scenario.js'
import type { Queue } from './queue.js'
import type { RunStore } from './store.js'
import type { RunJob, RunResult } from './types.js'
import { newRunId } from './id.js'

export class RunService {
  constructor(
    private readonly queue: Queue<RunJob>,
    private readonly store: RunStore,
  ) {}

  async submit(scenario: AnyScenario, params: unknown): Promise<{ ok: true; runId: string } | { ok: false }> {
    if (!this.queue.hasCapacity()) return { ok: false }
    const runId = newRunId()
    const queuedAt = new Date().toISOString()
    await this.store.create(runId, scenario.id, params, queuedAt)
    const accepted = this.queue.enqueue({ runId, scenario, params, queuedAt })
    if (!accepted) return { ok: false }
    return { ok: true, runId }
  }

  async getResult(runId: string): Promise<RunResult | undefined> {
    return this.store.get(runId)
  }
}
