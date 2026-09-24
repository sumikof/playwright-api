import oracledb, { type Connection, type Pool } from 'oracledb'
import { DbClosedError, DbTimeoutError, RowLimitExceededError, type DbProvider, type QueryOptions } from './provider.js'

export interface OracleProviderOptions {
  user: string
  password: string
  connectString: string
  poolMax: number
  queryTimeoutMs: number
  shutdownDrainS: number
}

const log = (what: string) => (err: unknown) => console.error(`[db] ${what}`, err)

/** deadline(epoch ms)までに p が決着しなければ DbTimeoutError */
function withDeadline<T>(p: Promise<T>, deadline: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DbTimeoutError()), Math.max(0, deadline - Date.now()))
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** NJS-040(queueTimeout)/ NJS-123(callTimeout)→ 504、NJS-065(pool closed)→ 503、その他は 500 */
function mapOracleError(err: unknown): unknown {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'NJS-040' || code === 'NJS-123') return new DbTimeoutError()
  if (code === 'NJS-065') return new DbClosedError()
  return err
}

/**
 * 本番用 Oracle(oracledb Thin モード)。
 * 接続取得から実行完了までを単一の期限(DB_QUERY_TIMEOUT_MS)で管理する。
 */
export class OracleProvider implements DbProvider {
  readonly dialect = 'oracle' as const
  private readonly poolPromise: Promise<Pool>
  private closed = false

  constructor(private readonly opts: OracleProviderOptions) {
    // poolMin=0 のため起動時には接続しない(DB 停止中でもサーバは起動する)
    this.poolPromise = oracledb.createPool({
      user: opts.user,
      password: opts.password,
      connectString: opts.connectString,
      poolMin: 0,
      poolMax: opts.poolMax,
      queueTimeout: opts.queryTimeoutMs,
      connectTimeout: Math.ceil(opts.queryTimeoutMs / 1000), // 防御。期限の根拠は外側タイマー
    })
    this.poolPromise.catch(log('failed to create the connection pool'))
  }

  async query(sql: string, binds: Record<string, unknown>, { maxRows }: QueryOptions): Promise<Record<string, unknown>[]> {
    if (this.closed) throw new DbClosedError()
    const deadline = Date.now() + this.opts.queryTimeoutMs

    let pool: Pool
    try {
      pool = await withDeadline(this.poolPromise, deadline)
    } catch (err) {
      throw mapOracleError(err)
    }

    // 空き枠への getConnection は物理接続の確立を伴うため、これも期限で打ち切る
    const pending = pool.getConnection()
    let conn: Connection
    try {
      conn = await withDeadline(pending, deadline)
    } catch (err) {
      if (err instanceof DbTimeoutError) {
        // 孤児化した取得: 遅れて解決した接続は返却し、遅延 reject と close 失敗も必ず処理する
        // (unhandledRejection はプロセスを落とすため)
        pending.then((c) => c.close()).catch(log('orphaned getConnection'))
      }
      throw mapOracleError(err)
    }

    let timedOut = false
    try {
      const remaining = deadline - Date.now()
      // 未実行なので接続は finally で通常どおり返却する
      if (remaining <= 0) throw new DbTimeoutError()
      conn.callTimeout = remaining // 往復単位の防御。契約の根拠にはしない
      // maxRows はドライバが黙って切り詰めるため、limit + 1 件目を観測できるよう 1 足して渡す
      const exec = conn.execute<Record<string, unknown>>(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        maxRows: maxRows + 1,
        fetchArraySize: maxRows + 1,
      })
      let result
      try {
        result = await withDeadline(exec, deadline)
      } catch (err) {
        if (err instanceof DbTimeoutError) {
          timedOut = true
          const c = conn
          exec.catch(() => {}) // break 後の ORA-01013 などは期限到来として処理済み
          // break / close が戻らなくても応答は期限内に返すため、完了を待たない(plan D6)
          c.break()
            .catch(log('break failed'))
            .finally(() => c.close({ drop: true }).catch(log('close after timeout failed')))
        }
        throw mapOracleError(err)
      }
      const rows = result.rows ?? []
      if (rows.length > maxRows) throw new RowLimitExceededError(maxRows)
      return rows
    } finally {
      if (!timedOut) await conn.close().catch(log('close failed'))
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const pool = await this.poolPromise.catch(() => null)
    // drainTime の間は新規取得を拒否しつつ使用中の接続の完了を待ち、経過後に強制クローズする
    await pool?.close(this.opts.shutdownDrainS)
  }
}
