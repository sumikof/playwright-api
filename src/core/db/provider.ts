import type { Config } from '../config.js'
import type { Dialect } from './query.js'
import { SqliteProvider } from './sqlite.js'
import { OracleProvider } from './oracle.js'

export interface QueryOptions {
  /** 接続取得〜実行完了までの期限(Oracle のみ適用) */
  timeoutMs: number
  /** 論理上限。maxRows + 1 件目が存在すれば RowLimitExceededError */
  maxRows: number
}

export interface DbProvider {
  readonly dialect: Dialect
  query(sql: string, binds: Record<string, unknown>, opts: QueryOptions): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

/** 結果が上限を超えた(黙って切り詰めない)。ルートで 500 に写像する */
export class RowLimitExceededError extends Error {
  constructor(readonly maxRows: number) {
    super(`row limit exceeded (maxRows=${maxRows})`)
    this.name = 'RowLimitExceededError'
  }
}

/** DB_QUERY_TIMEOUT_MS の期限到来。ルートで 504 に写像する */
export class DbTimeoutError extends Error {
  constructor(message = 'query timed out') {
    super(message)
    this.name = 'DbTimeoutError'
  }
}

/** close() 後の呼び出し。ルートで 503 に写像する */
export class DbClosedError extends Error {
  constructor(message = 'database is closed') {
    super(message)
    this.name = 'DbClosedError'
  }
}

/** DB_DIALECT 未設定なら null(DB 機能無効) */
export function createDbProvider(config: Config): DbProvider | null {
  const db = config.db
  switch (db.dialect) {
    case undefined:
      return null
    case 'sqlite':
      return new SqliteProvider(db.sqliteFile!)
    case 'oracle':
      return new OracleProvider({
        ...db.oracle!,
        poolMax: db.poolMax,
        queryTimeoutMs: db.queryTimeoutMs,
        shutdownDrainS: db.shutdownDrainS,
      })
  }
}
