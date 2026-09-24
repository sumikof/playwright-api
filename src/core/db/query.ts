import { z } from 'zod'

export type Dialect = 'sqlite' | 'oracle'

/** 方言差が避けられないときだけオブジェクトにし、上書きが無い方言は default を使う */
export type QuerySql = string | ({ default: string } & Partial<Record<Dialect, string>>)

export interface QueryDefinition<P extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
  id: string
  summary: string
  tags: string[]
  /** バインド変数(リクエストボディ)。zod object に限る */
  params: P
  /** 1 行の型(レスポンス rows[] の要素) */
  row: R
  /** :name 形式のバインド変数を使う SELECT / WITH 文 */
  sql: QuerySql
  /** 省略時は DB_MAX_ROWS。それを超える値は起動時エラー */
  maxRows?: number
}

export type AnyQuery = QueryDefinition

export function defineQuery<P extends z.ZodType, R extends z.ZodType>(query: QueryDefinition<P, R>): QueryDefinition<P, R> {
  return query
}

export function resolveSql(sql: QuerySql, dialect: Dialect): string {
  return typeof sql === 'string' ? sql : (sql[dialect] ?? sql.default)
}

function sqlVariants(sql: QuerySql): string[] {
  return typeof sql === 'string' ? [sql] : Object.values(sql).filter((v): v is string => typeof v === 'string')
}

/** コメント・文字列リテラル・引用識別子を取り除く(中の :name や SELECT を誤検出しないため) */
function stripNonCode(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
}

export function extractBindNames(sql: string): Set<string> {
  const names = new Set<string>()
  for (const m of stripNonCode(sql).matchAll(/(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)/g)) {
    names.add(m[1]!)
  }
  return names
}

export function isReadOnlyStatement(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(stripNonCode(sql))
}

/** ドライバへ渡すバインド。SQL に現れる名前だけを渡す(余剰キーは両ドライバともエラーになる) */
export function toBinds(sql: string, params: Record<string, unknown>): Record<string, unknown> {
  const binds: Record<string, unknown> = {}
  for (const name of extractBindNames(sql)) {
    binds[name] = params[name] ?? null
  }
  return binds
}

export function effectiveMaxRows(query: AnyQuery, dbMaxRows: number): number {
  return Math.min(query.maxRows ?? dbMaxRows, dbMaxRows)
}

/** id 重複・非 SELECT 文・バインド名と params の不整合・maxRows の不正を起動時に検出する */
export function buildQueryRegistry(queries: readonly AnyQuery[], opts: { maxRows: number }): Map<string, AnyQuery> {
  const registry = new Map<string, AnyQuery>()
  for (const q of queries) {
    const fail = (msg: string): never => {
      throw new Error(`query "${q.id}": ${msg}`)
    }
    if (registry.has(q.id)) throw new Error(`duplicate query id: ${q.id}`)

    if (!(q.params instanceof z.ZodObject)) fail('params must be a zod object')
    const paramKeys = new Set(Object.keys((q.params as z.ZodObject).shape))

    for (const sql of sqlVariants(q.sql)) {
      if (!isReadOnlyStatement(sql)) fail('sql must start with SELECT or WITH')
      const binds = extractBindNames(sql)
      for (const name of binds) {
        if (!paramKeys.has(name)) fail(`bind :${name} is not in params`)
      }
      for (const key of paramKeys) {
        if (!binds.has(key)) fail(`params key "${key}" is not used as a bind in sql`)
      }
    }

    if (q.maxRows !== undefined) {
      if (!Number.isSafeInteger(q.maxRows) || q.maxRows <= 0) fail(`maxRows must be a positive integer (got ${q.maxRows})`)
      if (q.maxRows > opts.maxRows) fail(`maxRows (${q.maxRows}) exceeds DB_MAX_ROWS (${opts.maxRows})`)
    }

    registry.set(q.id, q)
  }
  return registry
}
