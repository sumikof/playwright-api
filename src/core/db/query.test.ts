import { describe, it, expect } from 'vitest'
import { z } from '@hono/zod-openapi'
import {
  buildQueryRegistry,
  defineQuery,
  effectiveMaxRows,
  extractBindNames,
  isReadOnlyStatement,
  resolveSql,
  toBinds,
  type AnyQuery,
} from './query.js'

const q = (over: Partial<AnyQuery> = {}): AnyQuery =>
  defineQuery({
    id: 'products',
    summary: 's',
    tags: [],
    params: z.object({ minPrice: z.number() }),
    row: z.object({ id: z.number() }),
    sql: 'SELECT id AS "id" FROM products WHERE price >= :minPrice',
    ...over,
  }) as AnyQuery

describe('extractBindNames', () => {
  it('extracts :name binds once each', () => {
    expect(extractBindNames('WHERE a = :x AND b = :y_1 OR c = :x')).toEqual(new Set(['x', 'y_1']))
  })

  it('ignores comments, string literals and quoted identifiers', () => {
    const sql = `SELECT ':e' AS "f:g" -- :c
      FROM t /* :d */ WHERE a = :x AND b = 'it''s :h'`
    expect(extractBindNames(sql)).toEqual(new Set(['x']))
  })

  it('does not treat comment markers inside literals as comments', () => {
    expect(extractBindNames(`SELECT 'a--b' AS "x", :actual FROM dual`)).toEqual(new Set(['actual']))
    expect(extractBindNames(`SELECT '/*' AS "x", :a, '*/' AS "y" FROM dual`)).toEqual(new Set(['a']))
    expect(extractBindNames(`SELECT "a--b", :c FROM t`)).toEqual(new Set(['c']))
  })

  it('does not treat quotes inside comments as literals', () => {
    expect(extractBindNames(`SELECT 1 -- it's a comment\n FROM t WHERE a = :a /* don't */ AND b = :b`)).toEqual(new Set(['a', 'b']))
  })
})

describe('isReadOnlyStatement', () => {
  it.each(["-- don't\nSELECT 1", "/* it's */ SELECT 1", 'SELECT 1', 'select 1', '  \n SELECT 1', '-- c\nSELECT 1', '/* c */ WITH x AS (SELECT 1) SELECT * FROM x'])(
    'accepts %j',
    (sql) => expect(isReadOnlyStatement(sql)).toBe(true),
  )
  it.each(['UPDATE t SET a = 1', 'DELETE FROM t', 'INSERT INTO t VALUES (1)', 'CREATE TABLE t (a INT)', '  -- c\n DROP TABLE t', 'SELECTX', "/* 'x */ DELETE FROM t", "-- SELECT\nDELETE FROM t"])(
    'rejects %j',
    (sql) => expect(isReadOnlyStatement(sql)).toBe(false),
  )
})

describe('resolveSql', () => {
  it('uses a plain string for every dialect', () => {
    expect(resolveSql('SELECT 1', 'oracle')).toBe('SELECT 1')
  })
  it('uses the dialect override or falls back to default', () => {
    const sql = { default: 'SELECT 1 LIMIT 1', oracle: 'SELECT 1 FROM dual' }
    expect(resolveSql(sql, 'oracle')).toBe('SELECT 1 FROM dual')
    expect(resolveSql(sql, 'sqlite')).toBe('SELECT 1 LIMIT 1')
  })
})

describe('toBinds', () => {
  it('passes only names used in the SQL and maps undefined to null', () => {
    expect(toBinds('SELECT :a, :b', { a: 1, b: undefined, c: 3 })).toEqual({ a: 1, b: null })
  })
})

describe('effectiveMaxRows', () => {
  it('defaults to DB_MAX_ROWS and honours a smaller definition value', () => {
    expect(effectiveMaxRows(q(), 1000)).toBe(1000)
    expect(effectiveMaxRows(q({ maxRows: 10 }), 1000)).toBe(10)
  })
})

describe('buildQueryRegistry', () => {
  const opts = { maxRows: 1000 }

  it('registers valid queries', () => {
    const reg = buildQueryRegistry([q(), q({ id: 'other', maxRows: 1000 })], opts)
    expect([...reg.keys()]).toEqual(['products', 'other'])
  })

  it('rejects duplicate ids', () => {
    expect(() => buildQueryRegistry([q(), q()], opts)).toThrow(/duplicate query id: products/)
  })

  it('rejects non-SELECT statements in any variant', () => {
    expect(() => buildQueryRegistry([q({ sql: 'DELETE FROM products WHERE price >= :minPrice' })], opts)).toThrow(/SELECT or WITH/)
    expect(() =>
      buildQueryRegistry(
        [q({ sql: { default: 'SELECT 1 FROM t WHERE a = :minPrice', oracle: 'UPDATE t SET a = :minPrice' } })],
        opts,
      ),
    ).toThrow(/SELECT or WITH/)
  })

  it('rejects binds missing from params', () => {
    expect(() => buildQueryRegistry([q({ sql: 'SELECT 1 FROM t WHERE a = :minPrice AND b = :other' })], opts)).toThrow(
      /bind :other is not in params/,
    )
  })

  it('rejects params keys missing from the SQL (in any variant)', () => {
    expect(() => buildQueryRegistry([q({ sql: 'SELECT 1 FROM t' })], opts)).toThrow(/"minPrice" is not used/)
    expect(() =>
      buildQueryRegistry([q({ sql: { default: 'SELECT 1 FROM t WHERE a = :minPrice', sqlite: 'SELECT 1 FROM t' } })], opts),
    ).toThrow(/"minPrice" is not used/)
  })

  it('rejects params that are not a zod object', () => {
    expect(() => buildQueryRegistry([q({ params: z.string(), sql: 'SELECT 1' })], opts)).toThrow(/zod object/)
  })

  it.each([0, -1, 1.5, NaN, Infinity, 1001])('rejects maxRows=%s', (maxRows) => {
    expect(() => buildQueryRegistry([q({ maxRows })], opts)).toThrow(/maxRows/)
  })
})
