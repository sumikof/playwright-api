import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSqliteFile } from '../../src/core/testing/sqlite.js'

export const SEED_SQL_PATH = fileURLToPath(new URL('./seed.sql', import.meta.url))

/** seed.sql を流し込んだ SQLite ファイルを作る(既存ファイルは作り直す) */
export function seedSqlite(file: string): void {
  createSqliteFile(file, readFileSync(SEED_SQL_PATH, 'utf8'))
}

// CLI: npx tsx fixtures/demo-db/seed.ts ./demo.sqlite
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? './demo.sqlite'
  seedSqlite(file)
  console.log(`seeded ${file}`)
}
