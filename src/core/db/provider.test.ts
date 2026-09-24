import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { createSqliteFile } from '../testing/sqlite.js'
import { createDbProvider } from './provider.js'

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
})
