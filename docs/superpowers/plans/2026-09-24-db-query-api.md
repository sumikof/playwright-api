# DB データ取得 API(名前付きクエリ)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テスト対象システムの DB(本番 Oracle 19c 以降 / 開発 SQLite)からデータを取得する同期 API
`POST /queries/{id}` をひな形に追加する。fork 側は `src/queries/` に `defineQuery` を1つ足すだけで
API と OpenAPI が増える。

**Architecture:** 4 フェーズ。①DB 抽象(`DbProvider`)+ `SqliteProvider`(`node:sqlite`)+ 設定 +
shutdown の `src/core/lifecycle.ts` への切り出し ②クエリ定義・レジストリ・HTTP ルート・サンプル・seed
③`OracleProvider`(`oracledb` Thin、モックテスト)④ドキュメント・デプロイ manifest。

**Tech Stack:** TypeScript(ESM)、Hono(`@hono/zod-openapi`)、zod v4、`node:sqlite`、`oracledb ^7`、
Vitest、Kustomize。

**設計スペック:** `docs/superpowers/specs/2026-09-18-db-query-api-design.md`(Codex 設計レビュー収束
`1b5a78b`、ユーザー設計承認 2026-09-24)。本 plan は spec を再掲しない。各タスクは spec の該当節を
参照し、spec と plan が食い違ったら spec が正(plan を直す)。

**作業ブランチ:** `claude/development-status-check-n5e2be`(Draft PR #8、Relates to #7)。

## Global Constraints

- **言語**: コメント・ドキュメントは日本語(既存に合わせる)。HTTP エラーメッセージは既存どおり
  英語の `{ error: { message } }`。
- **確定済みの設計判断(覆さない)**: 任意 SQL 不採用 / 同期応答 / `node:sqlite` / `oracledb ^7` Thin /
  シナリオからの DB 参照なし。
- **既存 API・既存テストを壊さない**: `createApp` の新規依存は省略可能にし、既存の
  `createApp({ scenarios, service, runsDir })` 呼び出しがそのまま通ること。
- **`src/` のテストから `fixtures/` を import しない**: `tsconfig.json` は `rootDir: ./src` /
  `include: ["src"]` で、`src/**/*.test.ts` も `tsc` の対象になる。`src` から `fixtures/` の `.ts` を
  import すると `TS6059`(rootDir 外)で `npm run build` が落ちる(2026-09-24 に再現確認済み)。
  → 「plan で決めた実装詳細」D1 を参照。
- **ドライバへ渡すバインドは SQL 中に現れる名前だけ**: `node:sqlite` は未知の名前付き
  パラメータで `Unknown named parameter 'x'` を投げる(実行確認済み)。Oracle も同様に余剰
  バインドはエラーになるため、両方言で「SQL から抽出した名前」だけを渡す。
- **検証コマンド**: `npm test`(vitest)、`npm run build`(tsc)、`npm run test:e2e`(playwright)。
  初回は `npm ci` の後に `npx playwright install chromium` が必要。
- **サブエージェント**: 変更を伴う作業は主エージェント込みで同時 1(直列)。read-only 調査のみ並列可。
- **外部アクセス**: npm レジストリが一時的に 503 になることがある。`npm install` が失敗したら
  時間をおいて再試行し、解消しなければ BLOCKED として報告する。
- **コミット**: 各タスク末尾で 1 コミット(Conventional Commits、本文日本語可)。
  `git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit` で作成し、メッセージ末尾に
  次の 2 行を付ける:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HJDhc63NdQaBdEEjVdvjA8
  ```
  push は `git push -u origin claude/development-status-check-n5e2be`(フェーズ完了ごと)。

## plan で決めた実装詳細(spec の設計判断は変えない)

spec が実装に委ねている点、または spec の記述を満たすための実装手段。いずれも公開 API・データ
モデル・依存・受け入れ条件を変えないため、設計レビューへ戻す条件(方針 7.6)には当たらない。

| # | 事項 | 決定 | 理由 |
|---|---|---|---|
| D1 | `src/` のテストでの seed | テンプレート所有のテスト用ヘルパ `src/core/testing/sqlite.ts` に `createSqliteFile(file, sql)` を置き、`fixtures/demo-db/seed.ts` の `seedSqlite(file)` はこれに `seed.sql` を渡す薄いラッパにする。`src/` のユニットテストは `seed.sql` を **fs で読んで**(import しない)`createSqliteFile` に渡す。`tests/` の結合テストは `seedSqlite()` を直接使う | 上記 TS6059。spec の意図(seed 済み一時ファイルを readOnly で開き直す、書き込み可能な接続を製品コードの経路に入れない)はそのまま満たす。書き込み接続はテスト用ヘルパとseed スクリプトだけが使う |
| D2 | `oracledb` の型 | `@types/oracledb` は追加せず、使う API だけを宣言した `src/core/db/oracledb.d.ts`(`declare module 'oracledb'`)を置く | `oracledb@7.0.1` は型を同梱しない(`npm view` で `types` 無しを確認)。spec の依存表に無い新規依存を増やさない |
| D3 | エラー型 | `provider.ts` に `RowLimitExceededError`(→`500`)/ `DbTimeoutError`(→`504`)/ `DbClosedError`(→`503`)を置く | spec の「`RowLimitExceededError` を投げる」「`close()` 後の `query()` は `503` 相当」「期限到来は `504`」をルートで写像するため |
| D4 | `500` の本文 | 行数超過は spec どおり `row limit exceeded (maxRows=N)`。DB エラーは `Query failed`、行スキーマ違反は `Query result does not match the row schema` とし、詳細(ORA- コード、zod issue)はサーバログにだけ出す | 無認証 API で DB 内部情報(スキーマ名等)を返さない。fork の開発者はログで原因を追える |
| D5 | Oracle のエラーコード写像 | `NJS-040`(queueTimeout)・`NJS-123`(callTimeout。Thick の `DPI-1067` もドライバが `NJS-123` に寄せる)→ `DbTimeoutError`、`NJS-065`(pool closed)→ `DbClosedError`、その他 → そのまま(`500`) | `oracledb@7.0.1` の `lib/errors.js` で確認。`NJS-510`(connectTimeout)は spec どおり防御扱いで `500`(外側タイマーが先に `504` を返す) |
| D6 | Oracle 期限到来時の後始末 | 期限到来で即 `DbTimeoutError` を投げ、`break()` → `close({ drop: true })` は待たずに fire-and-forget(`.catch(log)` 付き)で行う | `break()` / `close()` 自体が戻らない場合にも応答を期限内に返すため(spec「break が効かない場合に備え…」の具体化) |
| D7 | Oracle プール作成 | `createDbProvider` は同期のまま(spec のシグネチャ)。`OracleProvider` のコンストラクタで `createPool()` の Promise を保持し `.catch(log)` を付ける。`query()` はその Promise も期限内で待つ | `createPool` は非同期。`poolMin=0` なので接続は試みない(spec「起動時に接続を試みない」) |
| D8 | SQLite ファイルが無い場合 | `SqliteProvider` のコンストラクタで readOnly オープンに失敗したら起動時エラー | 開発用途。設定ミスを最初のリクエストまで持ち越さない |
| D9 | `ExperimentalWarning` | `dev` スクリプトは変更せず、README に「`node:sqlite` の ExperimentalWarning が出るが動作に影響しない」と記載 | spec が実装判断に委ねた点。スクリプトのフラグ追加は tsx の引数受け渡しに依存し、得るものが小さい |
| D10 | `@types/node` | `^22`(`npm install -D @types/node@^22`) | 型は最も古い実行ランタイム(開発コンテナ Node 22.22)以下に揃える。Playwright イメージは Node 24 だが、24 固有 API を誤って使わないようにする |
| D12 | `node:sqlite` の読み込み | `SqliteProvider` のコンストラクタで `process.getBuiltinModule('node:sqlite')` により遅延読み込みする(型は `import type`) | 静的 import だと DB 無効時や Oracle 時にも `ExperimentalWarning` が出る(2026-09-24 実行確認)。spec「本番は Oracle 想定のため警告は出ない」を満たすため |
| D11 | Swagger UI のタグ | クエリのパスは `tags: ['queries']` にまとめる | 同名のシナリオ id とタグが衝突して Swagger UI で混ざらないようにする |

## 未決事項の解消

- spec「未決事項 1」(Playwright `v1.61.1-noble` 同梱 Node が 22.13 以上か): **解消**。
  `microsoft/playwright` の `v1.61.1` タグの `utils/docker/Dockerfile.noble` が
  `ARG NODE_VERSION=24`(NodeSource `node_24.x`)であることを確認した(2026-09-24)。
  Node 24 系は `node:sqlite` を無フラグで利用できるため設計どおり進める。Task 13 で spec の
  未決事項節をこの結果で更新する(内容の変更ではなく確認結果の記録)。

---

## Phase 1 — DB 抽象 + SQLite + 設定 + lifecycle

### Task 1: 依存の更新(`@types/node`)

**Files:** Modify `package.json`, `package-lock.json`

- [ ] **Step 1:** `npm install -D @types/node@^22`
- [ ] **Step 2:** `npx tsc --noEmit` が通ること、`node_modules/@types/node/sqlite.d.ts` が存在すること
- [ ] **Step 3:** `npm test` が 60/60 のまま
- [ ] **Step 4:** コミット `build: @types/node を ^22 に更新(node:sqlite の型定義)`

> `oracledb` は Phase 3(Task 10)で追加する(Phase 1〜2 だけで SQLite 版が完結するように)。

### Task 2: 設定(`config.ts`)

**Files:** Modify `src/core/config.ts`, Test `src/core/config.test.ts`

**Interfaces (Produces):**

```ts
export type DbDialect = 'sqlite' | 'oracle'
export interface DbConfig {
  dialect?: DbDialect               // 未設定なら DB 機能無効
  sqliteFile?: string               // dialect=sqlite 時必須。':memory:' 不可
  oracle?: { user: string; password: string; connectString: string } // dialect=oracle 時必須
  poolMax: number                   // DB_POOL_MAX(既定 2)
  queryTimeoutMs: number            // DB_QUERY_TIMEOUT_MS(既定 30000)
  maxRows: number                   // DB_MAX_ROWS(既定 1000)
  shutdownDrainS: number            // DB_SHUTDOWN_DRAIN_S(既定 10)
}
// Config に `db: DbConfig` を追加
```

- [ ] **Step 1: 失敗するテストを書く**(`config.test.ts` に追加)
  - `BASE_URL` のみ → `db` が `{ dialect: undefined, poolMax: 2, queryTimeoutMs: 30000, maxRows: 1000, shutdownDrainS: 10 }` 相当
  - `DB_DIALECT=sqlite` + `DB_SQLITE_FILE=./x.sqlite` → `db.dialect==='sqlite'`, `db.sqliteFile==='./x.sqlite'`
  - `DB_DIALECT=sqlite` で `DB_SQLITE_FILE` 無し → throw `/Invalid configuration/`
  - `DB_SQLITE_FILE=':memory:'` → throw
  - `DB_DIALECT=oracle` で `DB_ORACLE_USER` / `DB_ORACLE_PASSWORD` / `DB_ORACLE_CONNECT_STRING` のいずれか欠落 → throw(3 ケース)。3 つ揃えば `db.oracle` に入る
  - `DB_DIALECT=mysql` → throw
  - `DB_MAX_ROWS` が `0` / `-1` / `1.5` / `abc` → throw(spec「結果行数の上限」テスト)
  - `DB_SHUTDOWN_DRAIN_S` が `0` / `-1` / `1.5` / `abc` → throw(spec「テスト」表 config 行)
  - `DB_POOL_MAX` / `DB_QUERY_TIMEOUT_MS` の数値 coerce
- [ ] **Step 2:** `npm test -- src/core/config.test.ts` → FAIL を確認
- [ ] **Step 3: 実装**
  - `envSchema` に追加:
    ```ts
    DB_DIALECT: z.enum(['sqlite', 'oracle']).optional(),
    DB_SQLITE_FILE: z.string().min(1).optional(),
    DB_ORACLE_USER: z.string().min(1).optional(),
    DB_ORACLE_PASSWORD: z.string().min(1).optional(),
    DB_ORACLE_CONNECT_STRING: z.string().min(1).optional(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(2),
    DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    DB_MAX_ROWS: z.coerce.number().int().positive().default(1000),
    DB_SHUTDOWN_DRAIN_S: z.coerce.number().int().positive().default(10),
    ```
  - `.superRefine` で方言ごとの必須項目と `DB_SQLITE_FILE !== ':memory:'` を検証(issue の `path` に変数名を入れ、`prettifyError` で原因が読めるように)
  - `loadConfig` で `db: DbConfig` を組み立てる(`oracle` は dialect=oracle のときだけ設定)
- [ ] **Step 4:** `npm test -- src/core/config.test.ts` → PASS、`npx tsc --noEmit` → OK
- [ ] **Step 5:** コミット `feat(config): DB 接続設定(DB_DIALECT ほか)を追加`

### Task 3: `DbProvider` 抽象 + `SqliteProvider` + テスト用 SQLite ヘルパ

**Files:**
- Create `src/core/db/query.ts`(この時点では `Dialect` 型のみ。Task 5 で拡張)
- Create `src/core/db/provider.ts`, `src/core/db/sqlite.ts`, `src/core/testing/sqlite.ts`
- Test `src/core/db/sqlite.test.ts`, `src/core/db/provider.test.ts`

**Interfaces (Produces):**

```ts
// src/core/db/query.ts
export type Dialect = 'sqlite' | 'oracle'

// src/core/db/provider.ts
export interface QueryOptions { timeoutMs: number; maxRows: number }
export interface DbProvider {
  readonly dialect: Dialect
  query(sql: string, binds: Record<string, unknown>, opts: QueryOptions): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}
export class RowLimitExceededError extends Error { constructor(readonly maxRows: number) }   // message: `row limit exceeded (maxRows=${maxRows})`
export class DbTimeoutError extends Error {}
export class DbClosedError extends Error {}
export function createDbProvider(config: Config): DbProvider | null   // dialect 未設定なら null

// src/core/testing/sqlite.ts(テスト・seed 専用。製品コードからは使わない)
export function createSqliteFile(file: string, sql: string): void
```

- [ ] **Step 1: テスト用ヘルパを実装**(`src/core/testing/sqlite.ts`)
  ```ts
  import { rmSync } from 'node:fs'
  import { DatabaseSync } from 'node:sqlite'

  /** テスト・seed 専用: file を作り直して sql を流し込む(書き込み可能な接続はここだけで使う) */
  export function createSqliteFile(file: string, sql: string): void {
    rmSync(file, { force: true })
    const db = new DatabaseSync(file)
    try { db.exec(sql) } finally { db.close() }
  }
  ```
- [ ] **Step 2: 失敗するテストを書く**(`sqlite.test.ts`。一時ディレクトリに
  `createSqliteFile(file, 'CREATE TABLE p(id INTEGER, name VARCHAR(100), price INTEGER); INSERT INTO p VALUES (1,\'a\',100); …')`
  で 3 行作ってから `new SqliteProvider(file)`)
  - バインド: `SELECT id AS "id" … WHERE price >= :minPrice` に `{ minPrice: 150 }` → 2 行、値は number
  - 0 件 → `[]`
  - `maxRows` ちょうど(3 行・`maxRows: 3`)→ 3 行、`maxRows + 1` 行(`maxRows: 2`)→ `RowLimitExceededError`(`maxRows===2`)
  - SQL エラー(存在しないテーブル)→ reject(`RowLimitExceededError` / `DbTimeoutError` 以外)
  - 書き込み拒否: `DELETE FROM p` → reject(`attempt to write a readonly database`)。**プロバイダ経由で書けないこと**の確認
  - `close()` 後の `query()` → `DbClosedError`
  - 返却行がプレーンオブジェクト(`Object.getPrototypeOf(row) === Object.prototype`)。`node:sqlite` は null prototype の行を返すため
  - `new SqliteProvider(':memory:')` → throw、存在しないファイル → throw(D8)
- [ ] **Step 3:** `npm test -- src/core/db` → FAIL を確認
- [ ] **Step 4: `provider.ts` を実装**(エラー 3 種 + `createDbProvider`。この時点の `oracle` 分岐は
  `throw new Error('oracle provider is not implemented yet')`、Task 10 で差し替え)
- [ ] **Step 5: `sqlite.ts` を実装**
  ```ts
  export class SqliteProvider implements DbProvider {
    readonly dialect = 'sqlite' as const
    private db: DatabaseSync | null
    constructor(file: string) {
      if (file === ':memory:') throw new Error('DB_SQLITE_FILE must be a file path (:memory: is not allowed)')
      this.db = new DatabaseSync(file, { readOnly: true })
    }
    async query(sql, binds, { maxRows }) {          // timeoutMs は SQLite では適用しない(spec)
      if (!this.db) throw new DbClosedError('database is closed')
      const rows: Record<string, unknown>[] = []
      for (const row of this.db.prepare(sql).iterate(binds as Record<string, SQLInputValue>)) {
        if (rows.length >= maxRows) throw new RowLimitExceededError(maxRows)  // maxRows+1 件目で打ち切り
        rows.push({ ...row })
      }
      return rows
    }
    async close() { this.db?.close(); this.db = null }
  }
  ```
- [ ] **Step 6: `provider.test.ts`**: `createDbProvider` が dialect 未設定で `null`、sqlite で `SqliteProvider`(`dialect==='sqlite'`)
- [ ] **Step 7:** `npm test -- src/core/db` → PASS、`npx tsc --noEmit` → OK
- [ ] **Step 8:** コミット `feat(db): DbProvider 抽象と SqliteProvider(node:sqlite, readOnly)を追加`

### Task 4: `src/core/lifecycle.ts`(`gracefulShutdown` / `shutdownBudget`)と `index.ts` の切り替え

**Files:** Create `src/core/lifecycle.ts`, Test `src/core/lifecycle.test.ts`, Modify `src/index.ts`

**Interfaces (Produces):**

```ts
export interface ShutdownDeps {
  server: { close(cb?: (err?: Error) => void): unknown }
  queue: { drain(): Promise<void> }
  provider: { close(): Promise<void> }          // BrowserProvider
  db: { close(): Promise<void> } | null         // DbProvider
  drainTimeoutMs: number
}
export async function gracefulShutdown(deps: ShutdownDeps): Promise<void>   // 最後に process.exit(0)
export function shutdownBudget(o: { dbQueryTimeoutMs: number; dbShutdownDrainS: number }):
  { drainTimeoutMs: number; terminationGracePeriodSeconds: number }
```

- [ ] **Step 1: 失敗するテストを書く**(`lifecycle.test.ts`。`vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)`)
  - `shutdownBudget`: `30000/10` → `{ 35000, 65 }`、`60000/10` → `{ 65000, 95 }`、`1000/10` → `{ 30000, 60 }`(spec の 3 ケース)
  - 応答完了待ち: `@hono/node-server` の `serve()` をポート 0 で起動し、300ms 遅延して `200` を返す
    Hono ハンドラ(返す直前に `events.push('handler-done')`)へ `fetch` → 50ms 後に `gracefulShutdown`
    (`db.close` は `events.push('db-close')`、`queue.drain` は即 resolve、`drainTimeoutMs: 5000`)。
    `fetch` が `200`、`events` が `['handler-done', 'db-close']` の順、`process.exit(0)` が呼ばれる
  - 打ち切り: `queue.drain` が永遠に解決しない + `drainTimeoutMs: 100` → `gracefulShutdown` が 1 秒以内に
    完了し、`provider.close` と `db.close` が呼ばれる
  - `db: null` でも完了する。`provider.close` が reject しても `db.close` は呼ばれる
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3: 実装**(spec「シャットダウン時の drain」の手順 1〜5)
  ```ts
  export function shutdownBudget({ dbQueryTimeoutMs, dbShutdownDrainS }) {
    const drainTimeoutMs = Math.max(30000, dbQueryTimeoutMs + 5000)
    return { drainTimeoutMs, terminationGracePeriodSeconds: Math.ceil(drainTimeoutMs / 1000) + dbShutdownDrainS + 20 }
  }
  export async function gracefulShutdown(d: ShutdownDeps) {
    const serverClosed = new Promise<void>((resolve) => { d.server.close(() => resolve()) })
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, d.drainTimeoutMs) })
    await Promise.race([Promise.all([d.queue.drain(), serverClosed]), timeout])
    clearTimeout(timer)
    await d.provider.close().catch((err) => console.error('browser provider close failed', err))
    await d.db?.close().catch((err) => console.error('db provider close failed', err))
    process.exit(0)
  }
  ```
- [ ] **Step 4: `src/index.ts` を切り替える**
  - `const db = createDbProvider(config)`(この時点では sqlite / null のみ)
  - `const budget = shutdownBudget({ dbQueryTimeoutMs: config.db.queryTimeoutMs, dbShutdownDrainS: config.db.shutdownDrainS })`
  - listen ログに `  Recommended terminationGracePeriodSeconds: >= ${budget.terminationGracePeriodSeconds}` と、DB 有効時は `  Database: ${db.dialect}` を追加
  - 既存の `shutdown` 内の `server.close()` 〜 `process.exit(0)` を `await gracefulShutdown({ server, queue, provider, db, drainTimeoutMs: budget.drainTimeoutMs })` に置き換える(`shuttingDown` ガード、signal ログ、`uncaughtException` / `unhandledRejection` ハンドラは既存のまま)
- [ ] **Step 5:** `npm test` 全体 green、`npm run build` OK
- [ ] **Step 6: 手動確認**: `BASE_URL=http://localhost:4321 npm run dev` を起動し、推奨猶予 `65` のログが出ること、`Ctrl+C`(SIGINT)で終了すること
- [ ] **Step 7:** コミット `feat(lifecycle): shutdown を gracefulShutdown に切り出し応答完了と DB close を待つ`
- [ ] **Step 8:** push(Phase 1 完了)

---

## Phase 2 — クエリ定義・レジストリ・ルート・サンプル・seed

### Task 5: `defineQuery` / `buildQueryRegistry` / SQL 検査

**Files:** Modify `src/core/db/query.ts`, Test `src/core/db/query.test.ts`

**Interfaces (Produces):**

```ts
export type Dialect = 'sqlite' | 'oracle'
export type QuerySql = string | ({ default: string } & Partial<Record<Dialect, string>>)
export interface QueryDefinition<P extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
  id: string; summary: string; tags: string[]; params: P; row: R; sql: QuerySql; maxRows?: number
}
export type AnyQuery = QueryDefinition
export function defineQuery<P extends z.ZodType, R extends z.ZodType>(q: QueryDefinition<P, R>): QueryDefinition<P, R>
export function resolveSql(sql: QuerySql, dialect: Dialect): string          // 上書きが無ければ default
export function extractBindNames(sql: string): Set<string>                   // コメント・文字列・引用識別子を除いて :name を抽出
export function isReadOnlyStatement(sql: string): boolean                    // コメント・空白を除き SELECT / WITH で始まる
export function toBinds(sql: string, params: Record<string, unknown>): Record<string, unknown>  // SQL の名前だけ、undefined は null
export function effectiveMaxRows(q: AnyQuery, dbMaxRows: number): number     // min(q.maxRows ?? dbMaxRows, dbMaxRows)
export function buildQueryRegistry(queries: readonly AnyQuery[], opts: { maxRows: number }): Map<string, AnyQuery>
```

- [ ] **Step 1: 失敗するテストを書く**
  - `extractBindNames`: `WHERE a = :x AND b = :y_1` → `{x, y_1}`。`-- :c`、`/* :d */`、`':e'`、`"f:g"` は拾わない。`:x` の重複は 1 つ
  - `isReadOnlyStatement`: `SELECT` / `select` / 先頭に空白・`--` 行コメント・`/* */` があっても true、`WITH` → true、`UPDATE` / `DELETE` / `INSERT` / `CREATE` / `  -- c\n DROP` → false
  - `resolveSql`: 文字列はそのまま、`{ default, oracle }` は oracle で oracle、sqlite で default
  - `toBinds`: SQL に無い params キーは含めない、`undefined` は `null`
  - `effectiveMaxRows`: 省略時 `DB_MAX_ROWS`、指定時はその値
  - `buildQueryRegistry` が次で throw(spec「レジストリ」「結果行数の上限」):
    - id 重複
    - 非 SELECT 文(`sql` がオブジェクトなら全バリアントを検査)
    - SQL にあって `params` に無いバインド名 / `params` にあって SQL に無いキー(全バリアント)
    - `params` が zod object でない(`z.string()` 等)
    - `maxRows` が `0` / `-1` / `1.5` / `NaN` / `Infinity` / `DB_MAX_ROWS` 超過
  - 正常系: `maxRows === DB_MAX_ROWS` は OK、正しい定義 2 件で Map のサイズ 2
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3: 実装**
  - `extractBindNames`: 次の順で除去してから `/(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)/g` で抽出
    `--…` 行コメント → `/*…*/` → `'…'`(`''` エスケープ込み)→ `"…"`
  - `isReadOnlyStatement`: 同じ除去の後 `/^\s*(select|with)\b/i`
  - `buildQueryRegistry` のエラーメッセージには query id を含める(`query "products": bind :minPrice is not in params`)
  - `params` の zod object 判定は `params instanceof z.ZodObject`(`zod` の `z`。`@hono/zod-openapi` の `z` で作ったスキーマでも true になることをテストで確認)。キー集合は `Object.keys(params.shape)`
- [ ] **Step 4:** PASS、`npx tsc --noEmit` OK
- [ ] **Step 5:** コミット `feat(db): defineQuery と buildQueryRegistry(起動時検証)を追加`

### Task 6: seed(`fixtures/demo-db/`)

**Files:** Create `fixtures/demo-db/seed.sql`, `fixtures/demo-db/seed.ts`, Modify `.gitignore`

- [ ] **Step 1: `seed.sql`**(SQLite / Oracle 双方で通る最小限。1 文 1 行の INSERT、型は `INTEGER` / `VARCHAR(100)`。
  Oracle は `TEXT` 型を持たないため `VARCHAR` を使う。demo-app の商品一覧 A/B/C と対応)
  ```sql
  CREATE TABLE products (
    id    INTEGER PRIMARY KEY,
    name  VARCHAR(100) NOT NULL,
    price INTEGER NOT NULL
  );
  INSERT INTO products (id, name, price) VALUES (1, '商品A', 120);
  INSERT INTO products (id, name, price) VALUES (2, '商品B', 480);
  INSERT INTO products (id, name, price) VALUES (3, '商品C', 980);
  ```
  冒頭コメントに「Oracle では各文を SQL*Plus / SQL Developer で流す(末尾 `;` の扱いはツールに従う)」と書く
- [ ] **Step 2: `seed.ts`**
  ```ts
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
  ```
- [ ] **Step 3:** `.gitignore` の `# build & run artifacts` に `*.sqlite` を追加
- [ ] **Step 4: 確認**: `npx tsx fixtures/demo-db/seed.ts ./demo.sqlite` → `seeded ./demo.sqlite`、再実行でも成功(作り直し)、`git status` に `demo.sqlite` が出ない
- [ ] **Step 5:** コミット `feat(fixtures): demo-db の seed(products)を追加`

### Task 7: HTTP ルート(`routes/queries.ts`)と `createApp` 拡張

**Files:** Create `src/core/http/routes/queries.ts`, Modify `src/core/http/app.ts`, `src/core/http/schemas.ts`, Test `src/core/http/app.test.ts`

**Interfaces (Produces):**

```ts
// schemas.ts
export const querySummarySchema = z.object({ id: z.string(), summary: z.string(), tags: z.array(z.string()) })
export function queryResultSchema(row: z.ZodType) // { queryId, rowCount, durationMs, rows: z.array(row) }

// routes/queries.ts
export interface QueryRouteDeps {
  queries: AnyQuery[]; db: DbProvider | null; maxRows: number; timeoutMs: number
}
export function registerQueryRoutes(app: OpenAPIHono, deps: QueryRouteDeps): void

// app.ts
export interface AppDeps { scenarios; service; runsDir; queries?: QueryRouteDeps }   // 省略時はクエリルートを登録しない
```

- [ ] **Step 1: 失敗するテストを書く**(`app.test.ts` に `describe('query routes')` を追加)
  - セットアップ: 一時ディレクトリに `createSqliteFile(file, readFileSync(new URL('../../../fixtures/demo-db/seed.sql', import.meta.url), 'utf8'))`(**import ではなく fs 読み込み**。D1)→ `new SqliteProvider(file)`
  - テスト内クエリ: `productsQuery` と同等の定義(`src/queries/` は fork 所有のため core のテストは自前定義)、行スキーマ違反用(`row: z.object({ id: z.string() })`)、上限超過用(`maxRows: 2`、3 行返す)
  - `GET /queries` → `200` 一覧(id, summary, tags)
  - `POST /queries/products` `{ minPrice: 400 }` → `200`、`rowCount: 2`、`rows` が `[{ id: 2, name: '商品B', price: 480 }, { id: 3, … }]`、`durationMs` が number
  - `{ minPrice: 99999 }` → `200`、`rows: []`
  - `{}` → `200`(`default(0)` が効き 3 行)
  - `{ minPrice: -1 }` / `{ minPrice: 'x' }` → `400` `{ error: { message } }`
  - 行スキーマ違反 → `500`
  - 上限超過 → `500`、`error.message === 'row limit exceeded (maxRows=2)'`
  - `db: null` → `POST` は `503`、`GET /queries` は `200`
  - `DbTimeoutError` を投げるスタブ Provider → `504`、`DbClosedError` → `503`、その他の Error → `500` `Query failed`
  - Provider に渡る `maxRows` が `min(定義, DB_MAX_ROWS)`、`timeoutMs` が設定値、binds が SQL の名前だけ(スタブで記録)
  - OpenAPI: `/doc` に `/queries/products` の `post.requestBody` と `responses['200']` がある
  - 既存テスト(`queries` 省略の `createApp`)が引き続き通る
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3: 実装**(spec「API」節)
  - 一覧ルート `GET /queries`
  - クエリごとに `POST /queries/${q.id}`(`tags: ['queries']`(D11)、`summary: q.summary`、body は `q.params` で `required: true`、responses は `200: queryResultSchema(q.row)`、`400/500/503/504: errorSchema`)
  - ハンドラ:
    1. `db` が `null` → `503` `Database is not configured (DB_DIALECT)`
    2. `sql = resolveSql(q.sql, db.dialect)`、`binds = toBinds(sql, params)`、`limit = effectiveMaxRows(q, deps.maxRows)`
    3. `db.query(sql, binds, { timeoutMs, maxRows: limit })` を `performance.now()` で計測
    4. 例外写像(D3・D4): `RowLimitExceededError` → `500` `err.message` / `DbTimeoutError` → `504` `Query timed out` / `DbClosedError` → `503` `Database is shutting down` / その他 → `console.error` して `500` `Query failed`
    5. `z.array(q.row).safeParse(rows)` 失敗 → `console.error`(query id と issue)して `500`
    6. `200` `{ queryId, rowCount, durationMs: Math.round(ms), rows: parsed.data }`
  - `createApp`: `deps.queries` があれば `registerQueryRoutes(app, deps.queries)` をシナリオルートの後に呼ぶ
- [ ] **Step 4:** `npm test` 全体 green、`npx tsc --noEmit` OK
- [ ] **Step 5:** コミット `feat(http): POST /queries/{id} と GET /queries を追加`

### Task 8: サンプルクエリ(`src/queries/`)と `index.ts` への組み込み

**Files:** Create `src/queries/products.ts`, `src/queries/index.ts`, Modify `src/index.ts`

- [ ] **Step 1: `src/queries/products.ts`** — spec「クエリ定義」の例をそのまま(`summary: '指定価格以上の商品を取得する'`, `tags: ['catalog']`, `params: { minPrice: int, nonnegative, default 0 }`, `row: { id, name, price }`)。ファイル冒頭に「fork 所有・サンプル。登録解除は `index.ts` で行う」
- [ ] **Step 2: `src/queries/index.ts`** — `src/scenarios/index.ts` と同じ形:
  ```ts
  import type { AnyQuery } from '../core/db/query.js'
  import { productsQuery } from './products.js'

  // fork 所有: システム固有のクエリをここに登録する(サンプルの登録解除もここで行う)
  export const queries: AnyQuery[] = [productsQuery]
  ```
  (`defineQuery` の戻り型が `AnyQuery` に代入できない場合は `scenarios/index.ts` と同じ扱いにそろえる)
- [ ] **Step 3: `src/index.ts`** — `buildRegistry(scenarios)` の直後に `buildQueryRegistry(queries, { maxRows: config.db.maxRows })`、`createApp` に `queries: { queries, db, maxRows: config.db.maxRows, timeoutMs: config.db.queryTimeoutMs }` を渡す
- [ ] **Step 4:** `npm run build` OK、`npm test` green
- [ ] **Step 5:** コミット `feat(queries): サンプルクエリ products を追加しサーバに組み込む`

### Task 9: 結合テストと Swagger UI での確認

**Files:** Modify `tests/api.integration.test.ts`

- [ ] **Step 1: テスト追加**(`describe('query API integration')`。spec「テスト」表の結合行の順序どおり)
  1. `seedSqlite(join(tmp, 'demo.sqlite'))`(`fixtures/demo-db/seed.ts` を import。`tests/` は tsc 対象外)
  2. `loadConfig({ BASE_URL: 'http://localhost', DB_DIALECT: 'sqlite', DB_SQLITE_FILE: file })` → `createDbProvider(config)` → `buildQueryRegistry(queries, …)` → `createApp({ …, queries: { queries, db, … } })` を `serve()` でポート 0 起動
  3. 実 HTTP で `POST /queries/products` `{ minPrice: 400 }` → `200` / 2 行
  4. `afterAll` で server close、`db.close()`、一時ディレクトリ削除
- [ ] **Step 2:** `npm test` green
- [ ] **Step 3: 手動確認(受け入れ条件 Phase 2)**
  ```bash
  npx tsx fixtures/demo-db/seed.ts ./demo.sqlite
  BASE_URL=http://localhost:4321 DB_DIALECT=sqlite DB_SQLITE_FILE=./demo.sqlite npm run dev
  curl -s localhost:3000/queries
  curl -s -X POST localhost:3000/queries/products -H 'content-type: application/json' -d '{"minPrice":400}'
  ```
  あわせて Playwright(chromium)で `/ui` を開き、`POST /queries/products` の「Try it out → Execute」で
  `200` が表示されることをスクリーンショットで確認する(結果は PR 本文の検証結果に記録)
- [ ] **Step 4:** コミット `test: クエリ API の結合テストを追加`
- [ ] **Step 5:** push(Phase 2 完了)

---

## Phase 3 — Oracle Provider

### Task 10: `OracleProvider`(`oracledb` Thin)

**Files:** Modify `package.json` / `package-lock.json`, Create `src/core/db/oracle.ts`, `src/core/db/oracledb.d.ts`, Test `src/core/db/oracle.test.ts`, Modify `src/core/db/provider.ts`(oracle 分岐), `src/core/db/provider.test.ts`

**Interfaces (Produces):**

```ts
export interface OracleProviderOptions {
  user: string; password: string; connectString: string
  poolMax: number; queryTimeoutMs: number; shutdownDrainS: number
}
export class OracleProvider implements DbProvider { readonly dialect = 'oracle' }
```

- [ ] **Step 1:** `npm install oracledb@^7`(7.0.1 が入ること。`package.json` は `"oracledb": "^7.0.1"`)
- [ ] **Step 2: `oracledb.d.ts`(D2)** — 使う面だけを宣言: `createPool(attrs)`, `OUT_FORMAT_OBJECT`, `Pool.getConnection()` / `Pool.close(drainTime)`, `Connection.execute(sql, binds, opts)` / `break()` / `close(opts?: { drop?: boolean })` / `callTimeout`、`Result.rows`
- [ ] **Step 3: 失敗するテストを書く**(`vi.mock('oracledb', …)` で `createPool` がモック pool を返す。タイムアウト系は `queryTimeoutMs: 100` 程度の実タイマーで行い、`expect(elapsed).toBeLessThan(100 + 余裕)` を確認。spec「OracleProvider」テスト列挙に 1 対 1 で対応)
  1. `createPool` に `poolMin: 0`, `poolMax`, `queueTimeout: queryTimeoutMs`, `connectTimeout: ceil(queryTimeoutMs/1000)` が渡る。コンストラクタ時点で `getConnection` は呼ばれない
  2. 正常系: `getConnection` → `callTimeout` に残り時間(`>0` かつ `<= queryTimeoutMs`)が設定される → `execute(sql, binds, { outFormat: OUT_FORMAT_OBJECT, maxRows: limit + 1, fetchArraySize: limit + 1 })` → `close()` の順
  3. `limit` 行ちょうど → 成功、`limit + 1` 行 → `RowLimitExceededError`(このときも `close()` される)
  4. `execute` が SQL エラーで reject → そのまま reject(`DbTimeoutError` ではない)、`close()` される
  5. `getConnection` が `NJS-040` で reject(`poolMax` 飽和)→ `DbTimeoutError` が `queryTimeoutMs` 以内
  6. `getConnection` が解決しない → `DbTimeoutError` が `queryTimeoutMs` 以内。その後モック接続で遅れて解決させると `close()` が呼ばれる
  7. 期限後に `getConnection` が遅延 reject、および遅延解決後の `close()` が reject → `process.on('unhandledRejection')` のリスナが呼ばれない(テスト後に解除)、`console.error` が呼ばれる
  8. `execute` の解決を期限より遅らせる → `DbTimeoutError` が期限内、`break()` が呼ばれ、`close({ drop: true })` が呼ばれる。`break()` が解決しなくても `query()` は期限内に返る(D6)
  9. `execute` が `NJS-123` で reject → `DbTimeoutError`
  10. `close()` → `pool.close(shutdownDrainS)`、その後の `query()` → `DbClosedError`。`NJS-065` → `DbClosedError`
  11. `createPool` が reject → 起動時に unhandled にならず、`query()` は reject(`500` 相当)
- [ ] **Step 4:** FAIL を確認
- [ ] **Step 5: 実装**(spec「OracleProvider(本番用)」、D5〜D7)
  ```ts
  function withDeadline<T>(p: Promise<T>, deadline: number): Promise<T>   // 残り時間で DbTimeoutError。タイマーは finally で clear

  async query(sql, binds, { maxRows }) {
    if (this.closed) throw new DbClosedError('database is closed')
    const deadline = Date.now() + this.opts.queryTimeoutMs
    const pool = await withDeadline(this.poolPromise, deadline).catch(mapOracleError)
    const pending = pool.getConnection()
    let conn: Connection
    try {
      conn = await withDeadline(pending, deadline)
    } catch (err) {
      if (err instanceof DbTimeoutError) {
        // 孤児化した取得: 遅延解決なら返却、遅延 reject / close 失敗もログで必ず処理する
        pending.then((c) => c.close()).catch((e) => console.error('[db] orphaned getConnection', e))
      }
      throw mapOracleError(err)
    }
    let timedOut = false
    try {
      const remaining = deadline - Date.now()
      if (remaining <= 0) { timedOut = true; throw new DbTimeoutError('query timed out') }
      conn.callTimeout = remaining                        // 往復単位の防御(契約の根拠にしない)
      const exec = conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: maxRows + 1, fetchArraySize: maxRows + 1 })
      let result
      try {
        result = await withDeadline(exec, deadline)
      } catch (err) {
        if (err instanceof DbTimeoutError) {
          timedOut = true
          exec.catch(() => {})                            // break 後の ORA-01013 等を握る
          conn.break().catch(log).finally(() => conn.close({ drop: true }).catch(log))   // 待たない(D6)
        }
        throw mapOracleError(err)
      }
      const rows = (result.rows ?? []) as Record<string, unknown>[]
      if (rows.length > maxRows) throw new RowLimitExceededError(maxRows)
      return rows
    } finally {
      if (!timedOut) await conn.close().catch(log)
    }
  }
  async close() { this.closed = true; const pool = await this.poolPromise.catch(() => null); await pool?.close(this.opts.shutdownDrainS) }
  ```
  `mapOracleError`: `DbTimeoutError` / `DbClosedError` / `RowLimitExceededError` はそのまま、`code` が `NJS-040` / `NJS-123` → `DbTimeoutError`、`NJS-065` → `DbClosedError`、それ以外は元のエラー
- [ ] **Step 6: `createDbProvider` の oracle 分岐**を `new OracleProvider({ ...config.db.oracle, poolMax, queryTimeoutMs, shutdownDrainS })` に差し替え、`provider.test.ts` に oracle ケース(`vi.mock('oracledb')`)を追加
- [ ] **Step 7:** `npm test` green、`npm run build` OK。`node -e "import('oracledb').then(m => console.log(m.default.thin))"` が `true`(Thin が既定)
- [ ] **Step 8:** コミット `feat(db): OracleProvider(oracledb Thin、単一期限・行数上限・drain)を追加`
- [ ] **Step 9:** push(Phase 3 完了)。**実 Oracle での確認(`products` 相当が `200`)はユーザー環境で行う**旨を PR 本文の受け入れ条件に残す(Task 13 で手順を記載)

---

## Phase 4 — ドキュメント・デプロイ

### Task 11: manifest(`deploy/`)

**Files:** Modify `deploy/base/deployment.yaml`, `deploy/overlays/example/configmap.yaml`, `deploy/overlays/example/kustomization.yaml`, Create `deploy/overlays/example/secret.yaml`

- [ ] **Step 1: `deployment.yaml`**
  - `spec.template.spec.terminationGracePeriodSeconds: 70`(直上にコメントで内訳: `max(30, DB_QUERY_TIMEOUT_MS/1000 + 5)` 35 + `DB_SHUTDOWN_DRAIN_S` 10 + 余裕 20 = 65 → 70。`DB_QUERY_TIMEOUT_MS` / `DB_SHUTDOWN_DRAIN_S` を増やす overlay はこれも上書きする)
  - `envFrom` に `- secretRef: { name: playwright-api-db, optional: true }` を追加
- [ ] **Step 2: `configmap.yaml`** — コメントアウトで opt-in の見本: `DB_DIALECT: "oracle"`, `DB_ORACLE_CONNECT_STRING: "db.example.internal:1521/ORCLPDB1"`, `DB_ORACLE_USER: "e2e_readonly"`、任意で `DB_QUERY_TIMEOUT_MS` / `DB_MAX_ROWS` / `DB_SHUTDOWN_DRAIN_S`。パスワードは Secret で渡す旨
- [ ] **Step 3: `secret.yaml`(見本)** — `kind: Secret`, `name: playwright-api-db`, `stringData.DB_ORACLE_PASSWORD: "CHANGE_ME"`。冒頭コメントに「見本。実値はクラスタ側で `oc create secret generic playwright-api-db --from-literal=DB_ORACLE_PASSWORD=…` で作る。Git に実値を置かない。kustomization の resources には含めない」
- [ ] **Step 4: `kustomization.yaml`** — `secret.yaml` は resources に入れず、コメントで説明(route.yaml と同じ扱い)。`terminationGracePeriodSeconds` を上書きする patch の見本をコメントで併記
- [ ] **Step 5: 検証**: `kubectl kustomize deploy/overlays/example` の出力に `terminationGracePeriodSeconds: 70` と `secretRef` が含まれ、Secret リソースは含まれないこと。
  このコンテナには `kubectl` / `kustomize` / `oc` が無い(2026-09-24 確認)。kustomize のリリースバイナリを取得できればそれで実行し、取得できなければ YAML の構文確認に留めて、kustomize の実行はユーザー環境で行う旨を PR の検証結果に記録する
- [ ] **Step 6:** コミット `feat(deploy): terminationGracePeriodSeconds と DB Secret の見本を追加`

### Task 12: ドキュメント

**Files:** Modify `README.md`, `docs/deploy-openshift.md`, `docs/offline-build.md`, `docs/engineering-standards.md`

- [ ] **Step 1: README**
  - API 表に `GET /queries` / `POST /queries/{id}` を追加
  - 環境変数表に `DB_*` 9 変数(spec「設定」表と同じ既定値・説明)
  - クイックスタートに `npx tsx fixtures/demo-db/seed.ts ./demo.sqlite` → `DB_DIALECT=sqlite DB_SQLITE_FILE=./demo.sqlite` での起動と `curl` 例、`ExperimentalWarning` の注記(D9)
  - 「クエリを追加する」小節: `src/queries/<name>.ts` に `defineQuery` → `src/queries/index.ts` に登録、`:name` バインド、列エイリアスを `AS "name"` で明示、方言別 SQL、`maxRows`、SELECT / WITH のみ、起動時検証の内容
  - パス所有権表: fork 所有に `src/queries/`、共有(削除しない)に `fixtures/demo-db/`。「新しいシステムへ展開する」に `fixtures/demo-db/` は残す旨
  - 注意書き: DB データはシナリオ結果より機微になり得る。無認証のため Route 公開時は認証プロキシ必須。Oracle ユーザーは SELECT 権限のみ
- [ ] **Step 2: `docs/deploy-openshift.md`** — 「DB 接続(任意)」節: ConfigMap の `DB_*`、Secret の作成コマンド、`terminationGracePeriodSeconds` の算出式 `ceil(max(30, DB_QUERY_TIMEOUT_MS/1000 + 5)) + DB_SHUTDOWN_DRAIN_S + 20` と起動ログの推奨値、SELECT 権限のみのアカウント。「検証ステップ」に `terminationGracePeriodSeconds: 70` の確認を追加
- [ ] **Step 3: `docs/offline-build.md`** — `oracledb` は Thin モードで pure JS のため `vendor/node_modules.tar.gz` の手順は変わらない、Instant Client 不要、`node:sqlite` は Node 組み込み(ベースイメージ Node 24)である旨を 1 節
- [ ] **Step 4: `docs/engineering-standards.md`** — 「型定義は `@types/node` の都合で `^20`」を「`^22`(`node:sqlite` の型定義。最も古い実行ランタイムに合わせる)」に更新
- [ ] **Step 5:** コミット `docs: DB クエリ API の利用・デプロイ手順を追記`
- [ ] **Step 6:** push(Phase 4 完了)

---

## 仕上げ

### Task 13: ローカル検証・spec の未決事項更新・PR 更新

- [ ] **Step 1:** `git fetch origin main && git merge origin/main`(方針手順 11。差分があれば検証をやり直す)
- [ ] **Step 2:** `npm test` / `npm run build` / `npm run test:e2e` をすべて実行し、件数を記録
- [ ] **Step 3:** spec の「状態」行を「承認済み(`1b5a78b`、2026-09-24)」に、「未決事項 1」を「解消(Node 24、確認元)」に更新してコミット `docs(spec): 承認状態と未決事項(Node バージョン)の確認結果を記録`(設計内容の変更なし)
- [ ] **Step 4:** PR #8 本文を更新(テンプレート構造を維持): 現在のフェーズ(実装・ローカル検証を完了に)、変更内容、検証結果表、受け入れ条件のチェック、Oracle 実機確認手順(ユーザー環境: seed.sql を Oracle に流す → `DB_DIALECT=oracle …` で起動 → `POST /queries/products` が `200`)、既知の制限・未決事項
- [ ] **Step 5:** Draft 解除 → 最終レビュー用テンプレ(方針ファイル末尾)+「レビュー姿勢のお願い」で `@codex review`
- [ ] **Step 6:** ユーザーに報告(Codex 最終レビュー後の変更は再レビュー対象である旨を含める)

---

## plan ↔ spec 整合性チェック(方針 手順 9)

### spec → plan(spec の全要件・受け入れ条件がタスクに対応しているか)

| spec の要件・受け入れ条件 | 対応タスク |
|---|---|
| 要件 1: `src/core/` の骨格 + fork は定義を足すだけ | Task 3, 5, 7, 8 |
| 要件 2: Oracle / SQLite で同じ定義を実行(`:name` バインド、方言別 SQL) | Task 3, 5(`resolveSql`/`toBinds`), 10 |
| 要件 3: オフライン制約を壊さない(ネイティブ依存なし) | Task 1, 10(Thin、`node:sqlite`), 12(offline-build) |
| 任意 SQL 不採用 / 読み取り専用(SELECT/WITH 検査、権限で担保) | Task 5, 12 |
| 同期応答・ステータス 200/400/500/503/504 | Task 7 |
| OpenAPI にクエリごとのパス・型 | Task 7 |
| DB エラーは HTTP 500 | Task 7 |
| クエリ定義(`defineQuery`、列エイリアス規約、行検証) | Task 5, 7, 8, 12 |
| 結果行数の上限(`min`、`limit + 1`、`500`、正の整数検証、テスト) | Task 2, 3, 5, 7, 10 |
| レジストリ検証(id 重複、SELECT、バインド整合、maxRows) | Task 5, 8 |
| `DbProvider` 抽象・`createDbProvider` | Task 3, 10 |
| shutdown drain(`server.close(cb)` 待ち、`drainTimeoutMs` 連動、`shutdownBudget`、起動ログ、`lifecycle.test.ts`) | Task 4 |
| `SqliteProvider`(readOnly、`:memory:` 不可、`iterate` で打ち切り、seed 済み一時ファイル) | Task 3, 6(D1) |
| `@types/node` 更新と engineering-standards 更新 | Task 1, 12 |
| `OracleProvider`(プール、単一期限、`queueTimeout`/`connectTimeout`/`callTimeout`、孤児 Promise、`break()`、`maxRows + 1`、`504` 写像、`pool.close(drain)`、モックテスト) | Task 10 |
| 方言の切替(`DB_DIALECT` 1 つ) | Task 2, 3, 10 |
| 設定表 9 変数と条件付き検証、未設定時 `503` | Task 2, 7 |
| サンプルとテストデータ(`seed.sql`、`seed.ts`、`products.ts`、README クイックスタート) | Task 6, 8, 12 |
| ディレクトリ構造・所有権表 | Task 3〜8, 12 |
| デプロイ(ConfigMap / Secret 見本、`secretRef`、`terminationGracePeriodSeconds: 70`、kustomize 検証、docs) | Task 11, 12 |
| テスト表(SqliteProvider / registry / config / OracleProvider / ルート / 結合 / E2E 不変) | Task 2, 3, 5, 7, 9, 10, 13 |
| 開発フェーズ 1〜4 の完了条件 | Task 4(Phase 1), 9(Phase 2), 10(Phase 3), 11〜12(Phase 4), 13 |
| 受け入れ: 実 Oracle で `200`(ユーザー環境) | Task 10 Step 9, Task 13 Step 4 |
| 未決事項 1(Node バージョン) | 「未決事項の解消」節, Task 13 Step 3 |
| 意図的に含めないもの(書き込み・ctx.db・複数 DB・Thick・ページング・キャッシュ・認証) | 実装しない(どのタスクにも含まれないことを確認) |

### plan → spec(各タスクが spec に根拠を持つか)

| タスク | spec の根拠 |
|---|---|
| Task 1 | 「依存関係の追加」「SqliteProvider」の `@types/node` |
| Task 2 | 「設定」「結果行数の上限」「テスト」表 config 行 |
| Task 3 | 「DbProvider 抽象」「SqliteProvider」「テスト」表 SqliteProvider 行。D1(テスト用ヘルパ)は spec の seed 方針を満たす手段 |
| Task 4 | 「シャットダウン時の drain」 |
| Task 5 | 「クエリ定義」「結果行数の上限」「レジストリ」 |
| Task 6 | 「サンプルとテストデータ」 |
| Task 7 | 「API」、「テスト」表ルート行 |
| Task 8 | 「クエリ定義」「ディレクトリ構造」 |
| Task 9 | 「テスト」表 結合行、「開発フェーズ」2 |
| Task 10 | 「OracleProvider」「依存関係の追加」「テスト」表 OracleProvider 行 |
| Task 11 | 「デプロイ(OpenShift)」 |
| Task 12 | 「サンプルとテストデータ」(README)、「ディレクトリ構造」(所有権表)、「デプロイ」(docs)、「意図的に含めないもの」(認証の注意書き)、「SqliteProvider」(engineering-standards) |
| Task 13 | 運用方針 手順 11〜12、spec「未決事項」 |

**判定:** 双方向とも欠落なし。D1〜D11 は spec が実装に委ねた点または spec の記述を満たす手段であり、
公開 API・データモデル・新規依存・受け入れ条件・対象範囲を変えない(設計レビューへ戻す必要なし)。
