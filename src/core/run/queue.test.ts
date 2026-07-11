import { describe, it, expect } from 'vitest'
import { Queue } from './queue.js'

// 手動で解決できる deferred を作るヘルパ
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('Queue', () => {
  it('does not run more than maxConcurrency workers at once', async () => {
    const gates = [deferred(), deferred(), deferred()]
    let active = 0
    let maxActive = 0
    const q = new Queue<number>({ maxConcurrency: 1, maxQueue: 10 }, async (i) => {
      active++
      maxActive = Math.max(maxActive, active)
      await gates[i].promise
      active--
    })
    q.enqueue(0)
    q.enqueue(1)
    q.enqueue(2)
    // 1本だけ走っているはず
    await Promise.resolve()
    expect(q.stats.running).toBe(1)
    gates[0].resolve()
    gates[1].resolve()
    gates[2].resolve()
    await q.drain()
    expect(maxActive).toBe(1)
  })

  it('rejects enqueue when queue is full', () => {
    const q = new Queue<number>({ maxConcurrency: 1, maxQueue: 1 }, async () => {
      await new Promise(() => {}) // 永久に走り続ける
    })
    expect(q.enqueue(0)).toBe(true) // すぐ running になる
    expect(q.enqueue(1)).toBe(true) // waiting に1件（maxQueue=1）
    expect(q.enqueue(2)).toBe(false) // 満杯
    expect(q.hasCapacity()).toBe(false)
  })

  it('keeps running after a worker rejects', async () => {
    const ran: number[] = []
    const q = new Queue<number>({ maxConcurrency: 1, maxQueue: 10 }, async (i) => {
      ran.push(i)
      if (i === 0) throw new Error('boom')
    })
    q.enqueue(0)
    q.enqueue(1)
    await q.drain()
    expect(ran).toEqual([0, 1]) // second job ran even though the first threw; drain didn't hang
    expect(q.stats).toEqual({ waiting: 0, running: 0 })
  })
})
