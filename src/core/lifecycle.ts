export interface ShutdownDeps {
  server: { close(cb?: (err?: Error) => void): unknown }
  queue: { drain(): Promise<void> }
  /** BrowserProvider */
  provider: { close(): Promise<void> }
  /** DbProvider(DB 機能無効なら null) */
  db: { close(): Promise<void> } | null
  drainTimeoutMs: number
}

/**
 * shutdown の待ち時間の算出。
 * - drainTimeoutMs: HTTP 応答とブラウザジョブを待つ上限。DB クエリの期限到来後の
 *   break → 504 送信の後処理に 5 秒の余裕を持たせ、既存のブラウザ drain 30 秒を下限にする
 * - terminationGracePeriodSeconds: 上記 + DB の drain + provider.close / 終了の余裕 20 秒
 */
export function shutdownBudget(o: { dbQueryTimeoutMs: number; dbShutdownDrainS: number }): {
  drainTimeoutMs: number
  terminationGracePeriodSeconds: number
} {
  const drainTimeoutMs = Math.max(30000, o.dbQueryTimeoutMs + 5000)
  return {
    drainTimeoutMs,
    terminationGracePeriodSeconds: Math.ceil(drainTimeoutMs / 1000) + o.dbShutdownDrainS + 20,
  }
}

/**
 * 1. 新規受付を止め、処理中の HTTP 応答の完了を待つ(server.close の callback)
 * 2. 1 とブラウザジョブの drain を drainTimeoutMs まで待つ
 * 3. BrowserProvider → DbProvider の順に閉じて終了する
 */
export async function gracefulShutdown(d: ShutdownDeps): Promise<void> {
  const serverClosed = new Promise<void>((resolve) => {
    d.server.close(() => resolve())
  })
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, d.drainTimeoutMs)
  })
  await Promise.race([Promise.all([d.queue.drain(), serverClosed]), timeout])
  clearTimeout(timer)
  await d.provider.close().catch((err) => console.error('browser provider close failed', err))
  await d.db?.close().catch((err) => console.error('db provider close failed', err))
  process.exit(0)
}
