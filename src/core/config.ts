import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.url(),
  BROWSER: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  HEADLESS: z.stringbool().default(true),
  BROWSER_WS_ENDPOINT: z.url().optional(),
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  MAX_QUEUE: z.coerce.number().int().positive().default(100),
  RUNS_DIR: z.string().default('./runs'),
  RUN_RETENTION: z.coerce.number().int().positive().default(50),
  SCENARIO_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  BROWSER_LAUNCH_ARGS: z.string().default(''),
})

export interface Config {
  port: number
  baseURL: string
  browser: 'chromium' | 'firefox' | 'webkit'
  headless: boolean
  browserWsEndpoint?: string
  maxConcurrency: number
  maxQueue: number
  runsDir: string
  runRetention: number
  scenarioTimeoutMs: number
  browserLaunchArgs: string[]
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error('Invalid configuration:\n' + z.prettifyError(parsed.error))
  }
  const e = parsed.data
  return {
    port: e.PORT,
    baseURL: e.BASE_URL,
    browser: e.BROWSER,
    headless: e.HEADLESS,
    browserWsEndpoint: e.BROWSER_WS_ENDPOINT,
    maxConcurrency: e.MAX_CONCURRENCY,
    maxQueue: e.MAX_QUEUE,
    runsDir: e.RUNS_DIR,
    runRetention: e.RUN_RETENTION,
    scenarioTimeoutMs: e.SCENARIO_TIMEOUT_MS,
    browserLaunchArgs: e.BROWSER_LAUNCH_ARGS.split(' ').map((s) => s.trim()).filter(Boolean),
  }
}
