import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { serve, type ServerType } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { Hono } from 'hono'
import { gracefulShutdown, shutdownBudget } from './lifecycle.js'

describe('shutdownBudget', () => {
  it.each([
    [30000, 35000, 65],
    [60000, 65000, 95],
    [1000, 30000, 60],
  ])('dbQueryTimeoutMs=%i → drainTimeoutMs=%i, grace=%is', (dbQueryTimeoutMs, drainTimeoutMs, grace) => {
    expect(shutdownBudget({ dbQueryTimeoutMs, dbShutdownDrainS: 10 })).toEqual({
      drainTimeoutMs,
      terminationGracePeriodSeconds: grace,
    })
  })
})

describe('gracefulShutdown', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    exitSpy.mockRestore()
  })

  const noop = () => ({ close: vi.fn(async () => {}) })

  it('waits for in-flight HTTP responses before closing the DB', async () => {
    const events: string[] = []
    const app = new Hono()
    app.get('/slow', async (c) => {
      await new Promise((r) => setTimeout(r, 300))
      events.push('handler-done')
      return c.json({ ok: true })
    })
    const server: ServerType = await new Promise((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0 }, () => resolve(s))
    })
    const { port } = server.address() as AddressInfo

    const response = fetch(`http://127.0.0.1:${port}/slow`)
    await new Promise((r) => setTimeout(r, 50))
    const db = { close: vi.fn(async () => { events.push('db-close') }) }
    await gracefulShutdown({
      server,
      queue: { drain: async () => {} },
      provider: noop(),
      db,
      drainTimeoutMs: 5000,
    })

    const res = await response
    expect(res.status).toBe(200)
    expect(events).toEqual(['handler-done', 'db-close'])
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('stops waiting after drainTimeoutMs', async () => {
    const provider = noop()
    const db = noop()
    const started = Date.now()
    await gracefulShutdown({
      server: { close: (cb) => cb?.() },
      queue: { drain: () => new Promise<void>(() => {}) },
      provider,
      db,
      drainTimeoutMs: 100,
    })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(provider.close).toHaveBeenCalled()
    expect(db.close).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('works without a DB and closes the DB even if the browser provider fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = {
      server: { close: (cb?: () => void) => cb?.() },
      queue: { drain: async () => {} },
      drainTimeoutMs: 1000,
    }
    await gracefulShutdown({ ...deps, provider: noop(), db: null })
    expect(exitSpy).toHaveBeenCalledWith(0)

    const db = noop()
    await gracefulShutdown({ ...deps, provider: { close: async () => { throw new Error('boom') } }, db })
    expect(db.close).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
