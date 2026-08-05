import type { Page } from 'playwright'
import type { z } from 'zod'

export interface ScenarioContext {
  readonly page: Page
  readonly baseURL: string
  step<T>(name: string, fn: () => Promise<T>): Promise<T>
  screenshot(name: string): Promise<void>
  /**
   * trigger の実行中に開かれる新規タブ(popup)を待ち受け、そのタブを操作対象と
   * する子コンテキストを返す。ステップ・スクリーンショットの記録は親と共有される。
   * popup イベントは trigger より先に待ち受けを開始しないと取り逃すため、
   * トリガー操作はクロージャで受け取る。
   */
  waitForPopup(trigger: () => Promise<void>): Promise<ScenarioContext>
}

export interface Scenario<
  P extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
> {
  id: string
  summary: string
  tags: string[]
  params: P
  result: R
  run(ctx: ScenarioContext, params: z.infer<P>): Promise<z.infer<R>>
}

export type AnyScenario = Scenario

export function defineScenario<P extends z.ZodType, R extends z.ZodType>(
  scenario: Scenario<P, R>,
): Scenario<P, R> {
  return scenario
}
