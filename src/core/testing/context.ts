import { test, type Page, type TestInfo } from '@playwright/test'
import type { ScenarioContext } from '../scenario.js'

export class TestScenarioContext implements ScenarioContext {
  // 親子コンテキスト間でスクリーンショット連番を共有するため参照型で持つ
  private readonly counter: { screenshotIndex: number }

  constructor(
    readonly page: Page,
    readonly baseURL: string,
    private readonly testInfo: TestInfo,
    parent?: TestScenarioContext,
  ) {
    this.counter = parent?.counter ?? { screenshotIndex: 0 }
  }

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return test.step(name, fn)
  }

  async screenshot(name: string): Promise<void> {
    this.counter.screenshotIndex++
    const body = await this.page.screenshot({ fullPage: true })
    await this.testInfo.attach(`${String(this.counter.screenshotIndex).padStart(2, '0')}-${name}`, {
      body,
      contentType: 'image/png',
    })
  }

  async waitForPopup(trigger: () => Promise<void>): Promise<TestScenarioContext> {
    const [popup] = await Promise.all([
      this.page.waitForEvent('popup'),
      trigger(),
    ])
    await popup.waitForLoadState()
    return new TestScenarioContext(popup, this.baseURL, this.testInfo, this)
  }
}
