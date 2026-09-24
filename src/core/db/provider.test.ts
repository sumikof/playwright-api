import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { createSqliteFile } from '../testing/sqlite.js'
import { createDbProvider } from './provider.js'

const createPool = vi.fn(async () => ({ getConnection: vi.fn(), close: vi.fn(async () => {}) }))
vi.mock('oracledb', () => ({ default: { OUT_FORMAT_OBJECT: 4002, createPool: (...a: unknown[]) => createPool(...(a as [])) } }))

let dir: string | undefined
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('createDbProvider', () => {
  it('returns null when DB_DIALECT is unset', () => {
    expect(createDbProvider(loadConfig({ BASE_URL: 'http://x' }))).toBeNull()
  })

  it('creates a SqliteProvider for sqlite', async () => {
    dir = await mkdtemp(join(tmpdir(), 'provider-'))
    const file = join(dir, 'x.sqlite')
    createSqliteFile(file, 'CREATE TABLE t (id INTEGER);')
    const db = createDbProvider(loadConfig({ BASE_URL: 'http://x', DB_DIALECT: 'sqlite', DB_SQLITE_FILE: file }))
    expect(db?.dialect).toBe('sqlite')
    await db?.close()
  })

  it('creates an OracleProvider for oracle', async () => {
    const db = createDbProvider(
      loadConfig({
        BASE_URL: 'http://x',
        DB_DIALECT: 'oracle',
        DB_ORACLE_USER: 'u',
        DB_ORACLE_PASSWORD: 'p',
        DB_ORACLE_CONNECT_STRING: 'db:1521/x',
        DB_POOL_MAX: '3',
      }),
    )
    expect(db?.dialect).toBe('oracle')
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({ user: 'u', connectString: 'db:1521/x', poolMax: 3, queueTimeout: 30000 }))
    await db?.close()
  })
})
