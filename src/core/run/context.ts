import { join } from 'node:path'
import type { Page } from 'playwright'
import type { ScenarioContext } from '../scenario.js'
import type { StepResult, Artifact } from './types.js'

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export class ApiScenarioContext implements ScenarioContext {
  readonly steps: StepResult[]
  readonly artifacts: Artifact[]
  // 親子コンテキスト間でスクリーンショット連番を共有するため参照型で持つ
  private readonly counter: { screenshotIndex: number }

  constructor(
    readonly page: Page,
    readonly baseURL: string,
    private readonly runDir: string,
    private readonly runId: string,
    parent?: ApiScenarioContext,
  ) {
    this.steps = parent?.steps ?? []
    this.artifacts = parent?.artifacts ?? []
    this.counter = parent?.counter ?? { screenshotIndex: 0 }
  }

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
    this.counter.screenshotIndex++
    const fileName = `${String(this.counter.screenshotIndex).padStart(2, '0')}-${name}.png`
    await this.page.screenshot({ path: join(this.runDir, fileName), fullPage: true })
    this.artifacts.push({
      kind: 'screenshot',
      name: fileName,
      url: `/runs/${this.runId}/artifacts/${fileName}`,
    })
  }

  async waitForPopup(trigger: () => Promise<void>): Promise<ApiScenarioContext> {
    const [popup] = await Promise.all([
      this.page.waitForEvent('popup'),
      trigger(),
    ])
    await popup.waitForLoadState()
    return new ApiScenarioContext(popup, this.baseURL, this.runDir, this.runId, this)
  }
}
