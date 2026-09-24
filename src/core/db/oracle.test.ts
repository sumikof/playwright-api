import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const createPool = vi.fn()
vi.mock('oracledb', () => ({ default: { OUT_FORMAT_OBJECT: 4002, createPool: (...a: unknown[]) => createPool(...a) } }))

const { OracleProvider } = await import('./oracle.js')
const { DbClosedError, DbTimeoutError, RowLimitExceededError } = await import('./provider.js')

const TIMEOUT = 100
const opts = { user: 'u', password: 'p', connectString: 'db:1521/x', poolMax: 2, queryTimeoutMs: TIMEOUT, shutdownDrainS: 10 }
const q = { timeoutMs: TIMEOUT, maxRows: 2 }
const oraErr = (code: string) => Object.assign(new Error(code), { code })
const never = <T>() => new Promise<T>(() => {})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function makeConn(execute: () => Promise<{ rows?: unknown[] }> = async () => ({ rows: [] })) {
  return {
    callTimeout: 0,
    execute: vi.fn(execute),
    break: vi.fn(async () => {}),
    close: vi.fn(async (_o?: { drop?: boolean }) => {}),
  }
}
type Conn = ReturnType<typeof makeConn>

function makePool(getConnection: () => Promise<Conn>) {
  return { getConnection: vi.fn(getConnection), close: vi.fn(async (_d?: number) => {}) }
}

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  createPool.mockReset()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errSpy.mockRestore())

function setup(getConnection: () => Promise<Conn>) {
  const pool = makePool(getConnection)
  createPool.mockResolvedValue(pool)
  return { pool, db: new OracleProvider(opts) }
}

async function timed<T>(p: Promise<T>): Promise<{ result: T | unknown; elapsed: number }> {
  const start = Date.now()
  const result = await p.catch((e) => e)
  return { result, elapsed: Date.now() - start }
}

describe('OracleProvider', () => {
  it('creates the pool without connecting', () => {
    const { pool } = setup(async () => makeConn())
    expect(createPool).toHaveBeenCalledWith({
      user: 'u',
      password: 'p',
      connectString: 'db:1521/x',
      poolMin: 0,
      poolMax: 2,
      queueTimeout: TIMEOUT,
      connectTimeout: 1,
    })
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('executes with callTimeout, maxRows + 1 and closes the connection', async () => {
    const conn = makeConn(async () => ({ rows: [{ id: 1 }] }))
    const { db } = setup(async () => conn)
    const rows = await db.query('SELECT :a FROM dual', { a: 1 }, q)
    expect(rows).toEqual([{ id: 1 }])
    expect(conn.callTimeout).toBeGreaterThan(0)
    expect(conn.callTimeout).toBeLessThanOrEqual(TIMEOUT)
    expect(conn.execute).toHaveBeenCalledWith('SELECT :a FROM dual', { a: 1 }, { outFormat: 4002, maxRows: 3, fetchArraySize: 3 })
    expect(conn.close).toHaveBeenCalledWith()
  })

  it('allows exactly limit rows and rejects limit + 1 rows', async () => {
    const two = makeConn(async () => ({ rows: [{}, {}] }))
    expect(await setup(async () => two).db.query('SELECT 1', {}, q)).toHaveLength(2)

    const three = makeConn(async () => ({ rows: [{}, {}, {}] }))
    const err = await setup(async () => three).db.query('SELECT 1', {}, q).catch((e) => e)
    expect(err).toBeInstanceOf(RowLimitExceededError)
    expect(three.close).toHaveBeenCalled()
  })

  it('passes SQL errors through and still closes the connection', async () => {
    const conn = makeConn(async () => { throw oraErr('ORA-00942') })
    const err = await setup(async () => conn).db.query('SELECT 1', {}, q).catch((e) => e)
    expect(err.code).toBe('ORA-00942')
    expect(err).not.toBeInstanceOf(DbTimeoutError)
    expect(conn.close).toHaveBeenCalled()
  })

  it('maps a saturated pool (NJS-040) to DbTimeoutError within the deadline', async () => {
    const { db } = setup(async () => { await sleep(TIMEOUT - 20); throw oraErr('NJS-040') })
    const { result, elapsed } = await timed(db.query('SELECT 1', {}, q))
    expect(result).toBeInstanceOf(DbTimeoutError)
    expect(elapsed).toBeLessThan(TIMEOUT + 50)
  })

  it('times out a stalled getConnection and closes the connection when it resolves late', async () => {
    let resolveConn!: (c: Conn) => void
    const { db } = setup(() => new Promise<Conn>((r) => { resolveConn = r }))
    const { result, elapsed } = await timed(db.query('SELECT 1', {}, q))
    expect(result).toBeInstanceOf(DbTimeoutError)
    expect(elapsed).toBeLessThan(TIMEOUT + 50)

    const late = makeConn()
    resolveConn(late)
    await sleep(10)
    expect(late.close).toHaveBeenCalled()
    expect(late.execute).not.toHaveBeenCalled()
  })

  it('never leaves unhandled rejections from orphaned getConnection calls', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      // 1) 期限後に getConnection が reject
      let rejectConn!: (e: Error) => void
      const a = setup(() => new Promise<Conn>((_, rej) => { rejectConn = rej }))
      expect(await a.db.query('SELECT 1', {}, q).catch((e) => e)).toBeInstanceOf(DbTimeoutError)
      rejectConn(oraErr('NJS-510'))

      // 2) 期限後に解決した接続の close が reject
      let resolveConn!: (c: Conn) => void
      const b = setup(() => new Promise<Conn>((r) => { resolveConn = r }))
      expect(await b.db.query('SELECT 1', {}, q).catch((e) => e)).toBeInstanceOf(DbTimeoutError)
      const late = makeConn()
      late.close.mockRejectedValue(new Error('close failed'))
      resolveConn(late)

      await sleep(50)
      expect(unhandled).not.toHaveBeenCalled()
      expect(errSpy).toHaveBeenCalledTimes(2)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('breaks a long execute at the deadline and drops the connection', async () => {
    const conn = makeConn(() => never())
    conn.break.mockImplementation(() => never()) // break が戻らなくても期限内に返る
    const { db } = setup(async () => conn)
    const { result, elapsed } = await timed(db.query('SELECT 1', {}, q))
    expect(result).toBeInstanceOf(DbTimeoutError)
    expect(elapsed).toBeLessThan(TIMEOUT + 50)
    expect(conn.break).toHaveBeenCalled()
  })

  it('drops the connection after break completes', async () => {
    const conn = makeConn(() => never())
    const { db } = setup(async () => conn)
    expect(await db.query('SELECT 1', {}, q).catch((e) => e)).toBeInstanceOf(DbTimeoutError)
    await sleep(10)
    expect(conn.close).toHaveBeenCalledWith({ drop: true })
  })

  it('maps callTimeout (NJS-123) to DbTimeoutError', async () => {
    const conn = makeConn(async () => { throw oraErr('NJS-123') })
    expect(await setup(async () => conn).db.query('SELECT 1', {}, q).catch((e) => e)).toBeInstanceOf(DbTimeoutError)
    expect(conn.close).toHaveBeenCalled()
  })

  it('drains the pool on close() and rejects later queries', async () => {
    const { db, pool } = setup(async () => makeConn())
    await db.close()
    expect(pool.close).toHaveBeenCalledWith(10)
    await expect(db.query('SELECT 1', {}, q)).rejects.toBeInstanceOf(DbClosedError)
  })

  it('maps a closed pool (NJS-065) to DbClosedError', async () => {
    const { db } = setup(async () => { throw oraErr('NJS-065') })
    await expect(db.query('SELECT 1', {}, q)).rejects.toBeInstanceOf(DbClosedError)
  })

  it('does not crash when pool creation fails; queries reject', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      createPool.mockRejectedValue(oraErr('NJS-125'))
      const db = new OracleProvider(opts)
      await sleep(10)
      const err = await db.query('SELECT 1', {}, q).catch((e) => e)
      expect(err.code).toBe('NJS-125')
      await db.close()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
