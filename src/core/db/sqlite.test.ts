import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteFile } from '../testing/sqlite.js'
import { SqliteProvider } from './sqlite.js'
import { DbClosedError, DbTimeoutError, RowLimitExceededError } from './provider.js'

const SEED = `
  CREATE TABLE p (id INTEGER, name VARCHAR(100), price INTEGER);
  INSERT INTO p VALUES (1, 'a', 100);
  INSERT INTO p VALUES (2, 'b', 200);
  INSERT INTO p VALUES (3, 'c', 300);
`
const SELECT = 'SELECT id AS "id", name AS "name", price AS "price" FROM p WHERE price >= :minPrice ORDER BY id'
const opts = { timeoutMs: 1000, maxRows: 100 }

let dir: string
let file: string
let db: SqliteProvider

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sqlite-'))
  file = join(dir, 'test.sqlite')
  createSqliteFile(file, SEED)
  db = new SqliteProvider(file)
})
afterEach(async () => {
  await db.close()
  await rm(dir, { recursive: true, force: true })
})

describe('SqliteProvider', () => {
  it('binds named parameters and returns rows', async () => {
    const rows = await db.query(SELECT, { minPrice: 150 }, opts)
    expect(rows).toEqual([
      { id: 2, name: 'b', price: 200 },
      { id: 3, name: 'c', price: 300 },
    ])
  })

  it('returns plain objects', async () => {
    const [row] = await db.query(SELECT, { minPrice: 0 }, opts)
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
  })

  it('returns an empty array when nothing matches', async () => {
    expect(await db.query(SELECT, { minPrice: 9999 }, opts)).toEqual([])
  })

  it('allows exactly maxRows rows', async () => {
    const rows = await db.query(SELECT, { minPrice: 0 }, { ...opts, maxRows: 3 })
    expect(rows).toHaveLength(3)
  })

  it('throws RowLimitExceededError when maxRows + 1 rows exist', async () => {
    const err = await db.query(SELECT, { minPrice: 0 }, { ...opts, maxRows: 2 }).catch((e) => e)
    expect(err).toBeInstanceOf(RowLimitExceededError)
    expect(err.maxRows).toBe(2)
    expect(err.message).toBe('row limit exceeded (maxRows=2)')
  })

  it('rejects SQL errors as plain errors', async () => {
    const err = await db.query('SELECT * FROM nope', {}, opts).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(RowLimitExceededError)
    expect(err).not.toBeInstanceOf(DbTimeoutError)
  })

  it('cannot write through the provider (readOnly)', async () => {
    await expect(db.query('DELETE FROM p', {}, opts)).rejects.toThrow(/readonly/)
    expect(await db.query(SELECT, { minPrice: 0 }, opts)).toHaveLength(3)
  })

  it('throws DbClosedError after close()', async () => {
    await db.close()
    await expect(db.query(SELECT, { minPrice: 0 }, opts)).rejects.toBeInstanceOf(DbClosedError)
  })

  it('refuses :memory: and missing files', () => {
    expect(() => new SqliteProvider(':memory:')).toThrow(/:memory:/)
    expect(() => new SqliteProvider(join(dir, 'missing.sqlite'))).toThrow()
  })
})
