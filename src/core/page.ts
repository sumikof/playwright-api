import type { Page } from 'playwright'
import type { ScenarioContext } from './scenario.js'

/**
 * 各システムのページオブジェクトが継承する汎用ベースクラス。
 * ScenarioContext を受け取り、page とコンテキストを内部に保持する。
 */
export abstract class BasePage {
  protected readonly page: Page

  constructor(protected readonly ctx: ScenarioContext) {
    this.page = ctx.page
  }

  /** ステップとして処理を記録しつつ実行する */
  protected step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.ctx.step(name, fn)
  }

  /** スクリーンショットを取得してアーティファクトに残す */
  protected screenshot(name: string): Promise<void> {
    return this.ctx.screenshot(name)
  }
}
