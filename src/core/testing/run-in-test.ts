import type { Page, TestInfo } from '@playwright/test'
import type { z } from 'zod'
import type { Scenario } from '../scenario.js'
import { TestScenarioContext } from './context.js'

export async function runScenarioInTest<P extends z.ZodType, R extends z.ZodType>(
  scenario: Scenario<P, R>,
  params: z.infer<P>,
  opts: { page: Page; testInfo: TestInfo; baseURL: string },
): Promise<z.infer<R>> {
  const parsedParams = scenario.params.parse(params) as z.infer<P>
  const ctx = new TestScenarioContext(opts.page, opts.baseURL, opts.testInfo)
  const raw = await scenario.run(ctx, parsedParams)
  return scenario.result.parse(raw) as z.infer<R>
}
