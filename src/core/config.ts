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
  DB_DIALECT: z.enum(['sqlite', 'oracle']).optional(),
  DB_SQLITE_FILE: z.string().min(1).optional(),
  DB_ORACLE_USER: z.string().min(1).optional(),
  DB_ORACLE_PASSWORD: z.string().min(1).optional(),
  DB_ORACLE_CONNECT_STRING: z.string().min(1).optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(2),
  DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  DB_MAX_ROWS: z.coerce.number().int().positive().default(1000),
  DB_SHUTDOWN_DRAIN_S: z.coerce.number().int().positive().default(10),
}).superRefine((e, ctx) => {
  // 方言ごとの必須項目。DB_DIALECT 未設定は DB 機能無効として正常
  const required: Record<'sqlite' | 'oracle', (keyof typeof e)[]> = {
    sqlite: ['DB_SQLITE_FILE'],
    oracle: ['DB_ORACLE_USER', 'DB_ORACLE_PASSWORD', 'DB_ORACLE_CONNECT_STRING'],
  }
  if (!e.DB_DIALECT) return
  for (const key of required[e.DB_DIALECT]) {
    if (e[key] === undefined) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when DB_DIALECT=${e.DB_DIALECT}` })
    }
  }
  // readOnly の :memory: は常に空になるため許可しない
  if (e.DB_DIALECT === 'sqlite' && e.DB_SQLITE_FILE === ':memory:') {
    ctx.addIssue({ code: 'custom', path: ['DB_SQLITE_FILE'], message: 'DB_SQLITE_FILE must be a file path (:memory: is not allowed)' })
  }
})

export type DbDialect = 'sqlite' | 'oracle'

export interface DbConfig {
  /** 未設定なら DB 機能は無効(POST /queries/* は 503) */
  dialect?: DbDialect
  sqliteFile?: string
  oracle?: { user: string; password: string; connectString: string }
  poolMax: number
  queryTimeoutMs: number
  maxRows: number
  shutdownDrainS: number
}

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
  db: DbConfig
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
    db: {
      dialect: e.DB_DIALECT,
      sqliteFile: e.DB_DIALECT === 'sqlite' ? e.DB_SQLITE_FILE : undefined,
      oracle:
        e.DB_DIALECT === 'oracle'
          ? { user: e.DB_ORACLE_USER!, password: e.DB_ORACLE_PASSWORD!, connectString: e.DB_ORACLE_CONNECT_STRING! }
          : undefined,
      poolMax: e.DB_POOL_MAX,
      queryTimeoutMs: e.DB_QUERY_TIMEOUT_MS,
      maxRows: e.DB_MAX_ROWS,
      shutdownDrainS: e.DB_SHUTDOWN_DRAIN_S,
    },
  }
}
