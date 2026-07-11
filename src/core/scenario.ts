import type { Page } from 'playwright'
import type { z } from 'zod'

export interface ScenarioContext {
  readonly page: Page
  readonly baseURL: string
  step<T>(name: string, fn: () => Promise<T>): Promise<T>
  screenshot(name: string): Promise<void>
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
