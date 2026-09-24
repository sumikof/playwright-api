import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('applies defaults when only BASE_URL is set', () => {
    const cfg = loadConfig({ BASE_URL: 'http://localhost:4321' })
    expect(cfg.port).toBe(3000)
    expect(cfg.browser).toBe('chromium')
    expect(cfg.headless).toBe(true)
    expect(cfg.maxConcurrency).toBe(1)
    expect(cfg.maxQueue).toBe(100)
    expect(cfg.runRetention).toBe(50)
    expect(cfg.scenarioTimeoutMs).toBe(120000)
  })

  it('throws when BASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration/)
  })

  it('coerces numeric and boolean env vars', () => {
    const cfg = loadConfig({ BASE_URL: 'http://x.test', PORT: '8080', HEADLESS: 'false', MAX_CONCURRENCY: '3' })
    expect(cfg.port).toBe(8080)
    expect(cfg.headless).toBe(false)
    expect(cfg.maxConcurrency).toBe(3)
  })

  it('parses BROWSER_LAUNCH_ARGS into an args array', () => {
    const cfg = loadConfig({ BASE_URL: 'http://x', BROWSER_LAUNCH_ARGS: '--no-sandbox --disable-gpu' })
    expect(cfg.browserLaunchArgs).toEqual(['--no-sandbox', '--disable-gpu'])
  })

  it('defaults BROWSER_LAUNCH_ARGS to an empty array', () => {
    const cfg = loadConfig({ BASE_URL: 'http://x' })
    expect(cfg.browserLaunchArgs).toEqual([])
  })
})

describe('loadConfig (DB)', () => {
  const base = { BASE_URL: 'http://x' }
  const oracle = {
    DB_DIALECT: 'oracle',
    DB_ORACLE_USER: 'e2e',
    DB_ORACLE_PASSWORD: 'pw',
    DB_ORACLE_CONNECT_STRING: 'db:1521/ORCLPDB1',
  }

  it('disables the DB and applies defaults when DB_DIALECT is unset', () => {
    const cfg = loadConfig(base)
    expect(cfg.db).toEqual({
      dialect: undefined,
      sqliteFile: undefined,
      oracle: undefined,
      poolMax: 2,
      queryTimeoutMs: 30000,
      maxRows: 1000,
      shutdownDrainS: 10,
    })
  })

  it('accepts sqlite with DB_SQLITE_FILE', () => {
    const cfg = loadConfig({ ...base, DB_DIALECT: 'sqlite', DB_SQLITE_FILE: './x.sqlite' })
    expect(cfg.db.dialect).toBe('sqlite')
    expect(cfg.db.sqliteFile).toBe('./x.sqlite')
  })

  it('requires DB_SQLITE_FILE for sqlite', () => {
    expect(() => loadConfig({ ...base, DB_DIALECT: 'sqlite' })).toThrow(/DB_SQLITE_FILE/)
  })

  it('rejects :memory: for DB_SQLITE_FILE', () => {
    expect(() => loadConfig({ ...base, DB_DIALECT: 'sqlite', DB_SQLITE_FILE: ':memory:' })).toThrow(/:memory:/)
  })

  it('accepts oracle with all connection settings', () => {
    const cfg = loadConfig({ ...base, ...oracle })
    expect(cfg.db.dialect).toBe('oracle')
    expect(cfg.db.oracle).toEqual({ user: 'e2e', password: 'pw', connectString: 'db:1521/ORCLPDB1' })
  })

  it.each(['DB_ORACLE_USER', 'DB_ORACLE_PASSWORD', 'DB_ORACLE_CONNECT_STRING'])(
    'requires %s for oracle',
    (key) => {
      const env: Record<string, string> = { ...base, ...oracle }
      delete env[key]
      expect(() => loadConfig(env)).toThrow(new RegExp(key))
    },
  )

  it('rejects an unknown dialect', () => {
    expect(() => loadConfig({ ...base, DB_DIALECT: 'mysql' })).toThrow(/Invalid configuration/)
  })

  it.each(['0', '-1', '1.5', 'abc'])('rejects DB_MAX_ROWS=%s', (v) => {
    expect(() => loadConfig({ ...base, DB_MAX_ROWS: v })).toThrow(/Invalid configuration/)
  })

  it.each(['0', '-1', '1.5', 'abc'])('rejects DB_SHUTDOWN_DRAIN_S=%s', (v) => {
    expect(() => loadConfig({ ...base, DB_SHUTDOWN_DRAIN_S: v })).toThrow(/Invalid configuration/)
  })

  it('coerces numeric DB settings', () => {
    const cfg = loadConfig({
      ...base,
      DB_POOL_MAX: '4',
      DB_QUERY_TIMEOUT_MS: '60000',
      DB_MAX_ROWS: '50',
      DB_SHUTDOWN_DRAIN_S: '5',
    })
    expect(cfg.db).toMatchObject({ poolMax: 4, queryTimeoutMs: 60000, maxRows: 50, shutdownDrainS: 5 })
  })
})
