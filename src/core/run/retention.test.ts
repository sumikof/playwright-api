import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneRuns } from './retention.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ret-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('pruneRuns', () => {
  it('keeps the newest N run dirs and deletes older ones', async () => {
    // ULID は先頭がタイムスタンプなので、この昇順名は生成順に対応する
    const ids = ['01A', '01B', '01C', '01D', '01E']
    for (const id of ids) {
      await mkdir(join(dir, id), { recursive: true })
      await writeFile(join(dir, id, 'result.json'), '{}')
    }
    const deleted = await pruneRuns(dir, 2)
    const remaining = (await readdir(dir)).sort()
    expect(remaining).toEqual(['01D', '01E'])
    expect(deleted.sort()).toEqual(['01A', '01B', '01C'])
  })

  it('does nothing when runsDir is missing', async () => {
    const deleted = await pruneRuns(join(dir, 'nonexistent'), 5)
    expect(deleted).toEqual([])
  })
})
