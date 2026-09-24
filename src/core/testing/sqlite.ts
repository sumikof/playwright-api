import { rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/**
 * テスト・seed 専用: file を作り直して sql を流し込む。
 * 書き込み可能な接続はここだけで使い、製品コード(SqliteProvider)は常に readOnly で開く。
 */
export function createSqliteFile(file: string, sql: string): void {
  rmSync(file, { force: true })
  const db = new DatabaseSync(file)
  try {
    db.exec(sql)
  } finally {
    db.close()
  }
}
