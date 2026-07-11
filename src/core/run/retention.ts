import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export async function pruneRuns(runsDir: string, keep: number): Promise<string[]> {
  let entries: string[]
  try {
    const dirents = await readdir(runsDir, { withFileTypes: true })
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }

  // ULID は生成順 = 辞書順。降順に並べて先頭 keep 件を残す。
  const sorted = entries.sort().reverse()
  const toDelete = sorted.slice(keep)
  for (const name of toDelete) {
    await rm(join(runsDir, name), { recursive: true, force: true })
  }
  return toDelete
}
