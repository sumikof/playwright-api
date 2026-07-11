import { test, type Page, type TestInfo } from '@playwright/test'
import type { ScenarioContext } from '../scenario.js'

export class TestScenarioContext implements ScenarioContext {
  private screenshotIndex = 0

  constructor(
    readonly page: Page,
    readonly baseURL: string,
    private readonly testInfo: TestInfo,
  ) {}

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return test.step(name, fn)
  }

  async screenshot(name: string): Promise<void> {
    this.screenshotIndex++
    const body = await this.page.screenshot({ fullPage: true })
    await this.testInfo.attach(`${String(this.screenshotIndex).padStart(2, '0')}-${name}`, {
      body,
      contentType: 'image/png',
    })
  }
}
