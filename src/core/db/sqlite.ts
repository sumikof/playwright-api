import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { DbClosedError, RowLimitExceededError, type DbProvider, type QueryOptions } from './provider.js'

/**
 * 開発用 SQLite(node:sqlite)。常に readOnly で開く。
 * 実行は同期のため timeoutMs は適用しない。
 */
export class SqliteProvider implements DbProvider {
  readonly dialect = 'sqlite' as const
  private db: DatabaseSync | null

  constructor(file: string) {
    if (file === ':memory:') {
      throw new Error('DB_SQLITE_FILE must be a file path (:memory: is not allowed)')
    }
    this.db = new DatabaseSync(file, { readOnly: true })
  }

  async query(sql: string, binds: Record<string, unknown>, opts: QueryOptions): Promise<Record<string, unknown>[]> {
    if (!this.db) throw new DbClosedError()
    const rows: Record<string, unknown>[] = []
    for (const row of this.db.prepare(sql).iterate(binds as Record<string, SQLInputValue>)) {
      // maxRows + 1 件目を読んだ時点で打ち切る
      if (rows.length >= opts.maxRows) throw new RowLimitExceededError(opts.maxRows)
      // node:sqlite の行は null prototype のためプレーンオブジェクトにする
      rows.push({ ...(row as Record<string, unknown>) })
    }
    return rows
  }

  async close(): Promise<void> {
    this.db?.close()
    this.db = null
  }
}
