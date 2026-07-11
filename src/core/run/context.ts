import { join } from 'node:path'
import type { Page } from 'playwright'
import type { ScenarioContext } from '../scenario.js'
import type { StepResult, Artifact } from './types.js'

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export class ApiScenarioContext implements ScenarioContext {
  readonly steps: StepResult[] = []
  readonly artifacts: Artifact[] = []
  private screenshotIndex = 0

  constructor(
    readonly page: Page,
    readonly baseURL: string,
    private readonly runDir: string,
    private readonly runId: string,
  ) {}

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this.steps.push({ name, status: 'passed', durationMs: Date.now() - start })
      return result
    } catch (e) {
      this.steps.push({ name, status: 'failed', durationMs: Date.now() - start, error: { message: errMessage(e) } })
      throw e
    }
  }

  async screenshot(name: string): Promise<void> {
    this.screenshotIndex++
    const fileName = `${String(this.screenshotIndex).padStart(2, '0')}-${name}.png`
    await this.page.screenshot({ path: join(this.runDir, fileName), fullPage: true })
    this.artifacts.push({
      kind: 'screenshot',
      name: fileName,
      url: `/runs/${this.runId}/artifacts/${fileName}`,
    })
  }
}
