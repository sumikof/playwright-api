// oracledb@7 は型定義を同梱しないため、OracleProvider が使う面だけを宣言する(plan D2)。
declare module 'oracledb' {
  export interface PoolAttributes {
    user: string
    password: string
    connectString: string
    poolMin?: number
    poolMax?: number
    /** プール待ちの上限(ms)。超過は NJS-040 */
    queueTimeout?: number
    /** Thin モードの接続確立の上限(秒) */
    connectTimeout?: number
  }

  export interface ExecuteOptions {
    outFormat?: number
    maxRows?: number
    fetchArraySize?: number
  }

  export interface Result<T> {
    rows?: T[]
  }

  export interface Connection {
    /** 往復ごとの上限(ms) */
    callTimeout: number
    execute<T = unknown>(sql: string, binds: Record<string, unknown>, options: ExecuteOptions): Promise<Result<T>>
    break(): Promise<void>
    close(options?: { drop?: boolean }): Promise<void>
  }

  export interface Pool {
    getConnection(): Promise<Connection>
    /** drainTime 秒だけ使用中の接続の完了を待ってから閉じる */
    close(drainTime?: number): Promise<void>
  }

  const oracledb: {
    readonly OUT_FORMAT_OBJECT: number
    createPool(attrs: PoolAttributes): Promise<Pool>
  }
  export default oracledb
}
