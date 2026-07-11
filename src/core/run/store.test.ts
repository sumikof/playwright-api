import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileRunStore } from './store.js'
import type { RunResult } from './types.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runstore-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const finishedResult = (runId: string): RunResult => ({
  runId,
  scenarioId: 'login',
  status: 'passed',
  params: { email: 'a@b.c' },
  queuedAt: '2026-07-10T00:00:00.000Z',
  startedAt: '2026-07-10T00:00:01.000Z',
  finishedAt: '2026-07-10T00:00:02.000Z',
  durationMs: 1000,
  steps: [],
  data: { userName: 'x' },
  error: null,
  artifacts: [],
})

describe('FileRunStore', () => {
  it('returns the in-memory record after create', async () => {
    const store = new FileRunStore(dir)
    await store.create('R1', 'login', { email: 'a@b.c' }, '2026-07-10T00:00:00.000Z')
    const got = await store.get('R1')
    expect(got?.status).toBe('queued')
    expect(got?.startedAt).toBeNull()
  })

  it('marks a run as running with startedAt', async () => {
    const store = new FileRunStore(dir)
    await store.create('R1', 'login', {}, '2026-07-10T00:00:00.000Z')
    await store.markRunning('R1', '2026-07-10T00:00:01.000Z')
    const got = await store.get('R1')
    expect(got?.status).toBe('running')
    expect(got?.startedAt).toBe('2026-07-10T00:00:01.000Z')
  })

  it('reads result.json from disk when not in memory', async () => {
    const store = new FileRunStore(dir)
    const result = finishedResult('R2')
    await mkdir(join(dir, 'R2'), { recursive: true })
    await writeFile(join(dir, 'R2', 'result.json'), JSON.stringify(result))
    const got = await store.get('R2') // fresh store, nothing in memory
    expect(got?.status).toBe('passed')
    expect(got?.data).toEqual({ userName: 'x' })
  })

  it('returns interrupted when only meta.json exists', async () => {
    const store = new FileRunStore(dir)
    await mkdir(join(dir, 'R3'), { recursive: true })
    await writeFile(
      join(dir, 'R3', 'meta.json'),
      JSON.stringify({ runId: 'R3', scenarioId: 'login', params: {}, queuedAt: '2026-07-10T00:00:00.000Z' }),
    )
    const got = await store.get('R3')
    expect(got?.status).toBe('interrupted')
    expect(got?.scenarioId).toBe('login')
  })

  it('returns undefined for unknown runId', async () => {
    const store = new FileRunStore(dir)
    expect(await store.get('nope')).toBeUndefined()
  })

  it('writes result.json on finish', async () => {
    const store = new FileRunStore(dir)
    await store.create('R4', 'login', {}, '2026-07-10T00:00:00.000Z')
    await store.finish('R4', finishedResult('R4'))
    const fresh = new FileRunStore(dir)
    expect((await fresh.get('R4'))?.status).toBe('passed')
  })

  it('rethrows non-ENOENT read errors instead of swallowing them', async () => {
    const store = new FileRunStore(dir)
    // Create result.json as a directory, not a file, so readFile() throws EISDIR (not ENOENT).
    await mkdir(join(dir, 'R5', 'result.json'), { recursive: true })
    await expect(store.get('R5')).rejects.toThrow()
  })
})
